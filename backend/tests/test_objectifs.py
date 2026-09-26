"""L'extension « Objectifs » (migration 0065).

CE QUE CES TESTS VERROUILLENT :

  - UN MOIS RÉVOLU VAUT EXACTEMENT UNE UNITÉ DE CADENCE « mois », une année
    révolue exactement douze. C'est ce qui permet de lire un objectif mensuel
    sur son mois sans que la cible bouge de 31/30 selon le calendrier — sans cet
    invariant, le même objectif serait tenu en février et manqué en mars ;
  - LA CADENCE NE CHANGE PAS CE QU'ON COMPTE, seulement l'unité dans laquelle on
    le lit : 17 sorties sur un mois de 31 jours font 3,8 par semaine, et c'est
    ce chiffre-là qui se compare à la cible hebdomadaire ;
  - ON NE PRÉDIT RIEN. Quand la période tient dans une cadence — un objectif
    mensuel lu sur son mois — c'est le CUMUL qui se compare à la cible : le
    19 du mois, 196 € sur 250 €. La première version ramenait à la cadence et
    affichait « 309 € par mois », une extrapolation qui annonçait manqué un
    objectif qu'on pouvait encore tenir ;
  - LES DEUX PÉRIMÈTRES NE SE MÉLANGENT PAS. « Combien ça pèse » est ce que
    l'histogramme du dashboard affiche, au centime près — une dépense amortie y
    est étalée, une remboursable réduite à son reste à charge. « Combien de
    fois » compte des lignes de relevé : la même dépense amortie y compte pour
    UNE, entière, au mois où on l'a faite. Les confondre ferait mentir l'un des
    deux ;
  - UNE OPÉRATION DÉCOUPÉE COMPTE POUR UNE LIGNE et pour sa seule part dans la
    catégorie visée : c'est un passage en caisse, pas deux ;
  - UNE MOYENNE NE DIVISE QUE PAR DU TEMPS ÉCOULÉ : une période future ne laisse
    aucune unité, et le mois en cours ne compte que ses jours passés — diviser
    par la période entière ferait chuter la moyenne chaque 1er du mois, pour une
    raison qui n'a rien à voir avec les dépenses ;
  - L'EXTENSION NE CHANGE AUCUN CHIFFRE DU NOYAU. Créer dix objectifs ne touche
    ni les soldes, ni les flux, ni l'histogramme. C'est la promesse qui permet
    de l'éteindre sans conséquence, et elle se vérifie.
"""
import importlib.util
import pathlib
import sys
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import Sens, Statut, TypeOperation
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _charger(nom):
    racine = pathlib.Path(__file__).resolve().parents[2] / "extensions" / "objectifs"
    if str(racine) not in sys.path:
        sys.path.insert(0, str(racine))
    spec = importlib.util.spec_from_file_location(nom, racine / f"{nom}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom] = module
    spec.loader.exec_module(module)
    return module


service = _charger("service_objectifs")
schemas_obj = _charger("schemas_objectifs")
routeur = _charger("routeur_objectifs")


# ---------- Aides ----------


@pytest.fixture()
def compte(db_session):
    return creer_compte(db_session, "Courant", solde_initial=5000.0)


def _depense(db_session, compte, montant, jour, categorie="Loisirs & sorties", **extra):
    return crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=jour,
            nature=extra.get("nature", "Dépense"),
            montant=montant,
            sens=Sens.depense,
            statut=extra.get("statut", Statut.reel),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            categorie_id=get_categorie_id(db_session, categorie) if categorie else None,
            type_id=get_type_id(db_session, extra.get("type", TypeOperation.classique)),
            amorti=extra.get("amorti", False),
            amortissement_debut=extra.get("amortissement_debut"),
            amortissement_fin=extra.get("amortissement_fin"),
            montant_du=extra.get("montant_du"),
            decoupes=extra.get("decoupes") or [],
        ),
    )


def _objectif(db_session, **champs):
    defauts = {
        "nom": "Objectif",
        "mesure": "nombre",
        "cadence": "mois",
        "sens": "max",
        "cible": 4.0,
        "monnaie_id": get_monnaie_id(db_session),
    }
    objectif = models.ObjectifKpi(**{**defauts, **champs})
    db_session.add(objectif)
    db_session.commit()
    db_session.refresh(objectif)
    return objectif


# ---------- La cadence ----------


def test_un_mois_revolu_vaut_exactement_une_unite(db_session):
    """L'INVARIANT DE LA CADENCE. Un mois de 28 jours et un de 31 valent tous les
    deux UN mois : une cible mensuelle n'est pas un tarif journalier, et la
    proratiser par la longueur du mois aurait rendu le même objectif tenu en
    février et manqué en mars."""
    apres = date(2026, 12, 31)
    for mois in (1, 2, 4):
        assert service.unites_de_cadence("mois", 2026, mois, apres) == pytest.approx(1.0)


def test_une_annee_revolue_vaut_douze_mois_et_cinquante_deux_semaines(db_session):
    apres = date(2027, 6, 1)
    assert service.unites_de_cadence("mois", 2026, None, apres) == pytest.approx(12.0)
    assert service.unites_de_cadence("semaine", 2026, None, apres) == pytest.approx(
        365 / 7
    )


def test_un_mois_se_compte_en_semaines_de_sept_jours(db_session):
    """PAS LES SEMAINES DU CALENDRIER. Compter les blocs lundi-dimanche du mois
    aurait donné 5 ou 6 pour un mois de 31 jours selon le jour où il commence :
    une moyenne hebdomadaire aurait alors varié au gré du calendrier plutôt
    qu'au gré des dépenses."""
    apres = date(2026, 12, 31)
    assert service.unites_de_cadence("semaine", 2026, 3, apres) == pytest.approx(31 / 7)


def test_le_mois_en_cours_ne_compte_que_ses_jours_passes(db_session):
    """SINON TOUT SERAIT MANQUÉ LE 3 DU MOIS. Une cible mensuelle n'a pas encore
    eu le mois pour être tenue, et la comparer entière annoncerait un échec
    pendant vingt-huit jours."""
    assert service.unites_de_cadence(
        "mois", 2026, 6, date(2026, 6, 15)
    ) == pytest.approx(15 / 30)


def test_une_periode_future_ne_laisse_aucune_unite(db_session):
    assert service.unites_de_cadence("mois", 2027, 3, date(2026, 9, 19)) == 0.0
    assert service.unites_de_cadence("semaine", 2027, 3, date(2026, 9, 19)) == 0.0


# ---------- Compter des lignes ----------


def test_le_nombre_compte_les_lignes_et_se_ramene_a_la_cadence(db_session, compte):
    """17 SORTIES SUR UN MOIS, C'EST 3,8 PAR SEMAINE. La valeur brute et la
    valeur ramenée voyagent toutes les deux : « 17 contre 3 » ferait paraître
    manqué un objectif tenu, « 3,8 » seul cacherait ce qui a été compté."""
    for jour in range(1, 18):
        _depense(db_session, compte, 20.0, date(2026, 3, jour))

    objectif = _objectif(
        db_session,
        mesure="nombre",
        cadence="semaine",
        cible=4.0,
        categorie_id=get_categorie_id(db_session, "Loisirs & sorties"),
    )
    mesure = service.mesurer(db_session, objectif, 2026, 3, date(2026, 12, 31))

    assert mesure["valeur"] == pytest.approx(17.0)
    assert mesure["unites"] == pytest.approx(31 / 7)
    assert mesure["mode"] == "moyenne"
    assert mesure["valeur_cadence"] == pytest.approx(17 / (31 / 7))
    # 3,84 par semaine pour une cible de 4 : tenu.
    assert mesure["atteint"] is True


def test_un_objectif_mensuel_lu_sur_son_mois_ne_predit_rien(db_session, compte):
    """LE DÉFAUT QUE LA PREMIÈRE VERSION AVAIT, ET QUI SE VOYAIT À L'ÉCRAN : le
    19 du mois, 196 € dépensés sur une cible de 250 € s'affichaient « 309 € par
    mois » — la valeur ramenée à la cadence, c'est-à-dire une EXTRAPOLATION. Elle
    annonçait manqué un objectif qu'on pouvait encore tenir, et donnait un
    chiffre qu'aucune addition de l'écran ne produit.

    QUAND LA PÉRIODE TIENT DANS UNE CADENCE, ON COMPARE LE CUMUL À LA CIBLE, et
    rien d'autre. Convertir n'a de sens que lorsque la période contient
    PLUSIEURS cadences (cf. le test de la moyenne hebdomadaire)."""
    _depense(db_session, compte, 120.0, date(2026, 9, 3))
    _depense(db_session, compte, 76.0, date(2026, 9, 12))

    objectif = _objectif(
        db_session, mesure="montant_total", cadence="mois", sens="max", cible=250.0
    )
    mesure = service.mesurer(db_session, objectif, 2026, 9, date(2026, 9, 19))

    assert mesure["mode"] == "cumul"
    assert mesure["valeur_cadence"] == pytest.approx(196.0)
    assert mesure["atteint"] is True
    # Et la cible ne bouge pas non plus : c'est celle qu'on a écrite.
    assert mesure["avancement"] == pytest.approx(196.0 / 250.0 * 100.0)


def test_un_objectif_mensuel_lu_sur_une_annee_devient_une_moyenne(db_session, compte):
    """L'AUTRE MOITIÉ DE LA RÈGLE. Douze mois de dépenses comparés à une cible
    MENSUELLE ne veulent rien dire : là, il faut convertir — et c'est une
    moyenne sur le temps écoulé, jamais une prévision."""
    for mois in range(1, 5):
        _depense(db_session, compte, 100.0, date(2026, mois, 10))

    objectif = _objectif(
        db_session, mesure="montant_total", cadence="mois", sens="max", cible=150.0
    )
    mesure = service.mesurer(db_session, objectif, 2026, None, date(2026, 12, 31))

    assert mesure["mode"] == "moyenne"
    assert mesure["unites"] == pytest.approx(12.0)
    assert mesure["valeur"] == pytest.approx(400.0)
    assert mesure["valeur_cadence"] == pytest.approx(400.0 / 12)
    assert mesure["atteint"] is True


def test_une_depense_amortie_compte_pour_une_ligne_entiere(db_session, compte):
    """LE PÉRIMÈTRE « COMBIEN DE FOIS » NE S'ÉTALE PAS. Une facture amortie sur
    douze mois reste UNE dépense, faite une fois, au mois où on l'a faite — un
    compte ne se découpe pas en douzièmes."""
    _depense(
        db_session,
        compte,
        1200.0,
        date(2026, 4, 10),
        amorti=True,
        amortissement_debut=date(2026, 4, 1),
        amortissement_fin=date(2027, 3, 1),
    )

    objectif = _objectif(db_session, mesure="nombre", cadence="mois", cible=1.0)
    avril = service.mesurer(db_session, objectif, 2026, 4, date(2026, 12, 31))
    mai = service.mesurer(db_session, objectif, 2026, 5, date(2026, 12, 31))

    assert avril["valeur"] == pytest.approx(1.0)
    assert mai["valeur"] == pytest.approx(0.0)


def test_le_montant_moyen_compte_le_reste_a_charge(db_session, compte):
    """UNE DÉPENSE REMBOURSABLE COMPTE POUR CE QU'ELLE COÛTE, pas pour ce qui est
    sorti du compte. Les 60 € d'un repas dont on récupère 50 pèsent 10 € au
    budget : une moyenne qui les compterait entiers dirait ce qu'on a AVANCÉ, et
    non ce qu'on a dépensé — deux chiffres que rien à l'écran ne distingue.

    C'EST LA RÈGLE DE L'HISTOGRAMME (cf. soldes._base_imposable), et les deux
    périmètres ne diffèrent donc plus que sur l'étalement — le seul point où ils
    doivent différer (une facture amortie reste UNE ligne du relevé)."""
    _depense(db_session, compte, 40.0, date(2026, 5, 3))
    _depense(
        db_session,
        compte,
        60.0,
        date(2026, 5, 12),
        type=TypeOperation.remboursable,
        montant_du=50.0,
    )

    objectif = _objectif(db_session, mesure="montant_moyen", cadence="mois", cible=45.0)
    mesure = service.mesurer(db_session, objectif, 2026, 5, date(2026, 12, 31))

    # Deux LIGNES — le compte ne change pas, c'est ce que chacune pèse qui change.
    assert mesure["echantillon"] == 2
    assert mesure["valeur"] == pytest.approx(25.0)
    # Une moyenne ne se convertit pas : elle se compare à sa cible telle quelle.
    assert mesure["mode"] == "cumul"
    assert mesure["valeur_cadence"] == pytest.approx(25.0)
    assert mesure["atteint"] is True


def test_une_remboursable_integralement_due_ne_compte_pas(db_session, compte):
    """ELLE NE COÛTE RIEN, elle ne doit donc tirer aucune moyenne vers le bas.
    Une ligne à zéro n'est pas une dépense à 0 € : c'est une avance, dont on
    récupérera tout."""
    _depense(db_session, compte, 40.0, date(2026, 5, 3))
    _depense(
        db_session,
        compte,
        200.0,
        date(2026, 5, 12),
        type=TypeOperation.remboursable,
        montant_du=200.0,
    )

    objectif = _objectif(db_session, mesure="montant_moyen", cadence="mois", cible=45.0)
    mesure = service.mesurer(db_session, objectif, 2026, 5, date(2026, 12, 31))

    assert mesure["echantillon"] == 1
    assert mesure["valeur"] == pytest.approx(40.0)


def test_sans_depense_la_moyenne_vaut_zero_et_ne_divise_rien(db_session, compte):
    objectif = _objectif(db_session, mesure="montant_moyen", cible=45.0)
    mesure = service.mesurer(db_session, objectif, 2026, 7, date(2026, 12, 31))
    assert mesure["echantillon"] == 0
    assert mesure["valeur"] == 0.0


def test_une_operation_decoupee_compte_pour_une_ligne_et_pour_sa_part(
    db_session, compte
):
    """UN PASSAGE EN CAISSE, PAS DEUX. Un plein de courses à 120 € dont 30 € de
    produits ménagers est UNE ligne du relevé ; la compter deux fois parce qu'on
    en a rangé une part ailleurs ferait mentir « combien de fois »."""
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    autres = get_categorie_id(db_session, "Autres")
    _depense(
        db_session,
        compte,
        120.0,
        date(2026, 6, 4),
        categorie=None,
        decoupes=[
            schemas.DecoupeInput(categorie_id=alimentaire, montant=90.0),
            schemas.DecoupeInput(categorie_id=autres, montant=30.0),
        ],
    )

    objectif = _objectif(
        db_session,
        mesure="montant_moyen",
        cible=100.0,
        categorie_id=alimentaire,
    )
    mesure = service.mesurer(db_session, objectif, 2026, 6, date(2026, 12, 31))

    assert mesure["echantillon"] == 1
    assert mesure["valeur"] == pytest.approx(90.0)


# ---------- Peser comme le dashboard ----------


def test_le_montant_total_vaut_la_barre_de_l_histogramme(db_session, compte):
    """L'INVARIANT DU PÉRIMÈTRE « COMBIEN ÇA PÈSE ». Un objectif posé sous
    l'histogramme et qui annoncerait un autre chiffre que la barre juste
    au-dessus serait un objectif qu'on cesse de croire — d'où l'emprunt du
    calcul du noyau plutôt que sa recopie."""
    m = get_monnaie_id(db_session)
    _depense(db_session, compte, 200.0, date(2026, 8, 3))
    _depense(
        db_session,
        compte,
        300.0,
        date(2026, 8, 9),
        type=TypeOperation.remboursable,
        montant_du=120.0,
    )
    _depense(
        db_session,
        compte,
        1200.0,
        date(2026, 8, 15),
        amorti=True,
        amortissement_debut=date(2026, 8, 1),
        amortissement_fin=date(2027, 7, 1),
    )

    barres = soldes.get_depenses_par_categorie(db_session, 2026, 8, m)
    barre = next(b for b in barres if b["categorie"] == "Loisirs & sorties")

    objectif = _objectif(
        db_session,
        mesure="montant_total",
        cible=1000.0,
        categorie_id=get_categorie_id(db_session, "Loisirs & sorties"),
    )
    mesure = service.mesurer(db_session, objectif, 2026, 8, date(2026, 12, 31))

    assert mesure["valeur"] == pytest.approx(barre["total_reel"])


def test_la_part_est_celle_du_camembert(db_session, compte):
    m = get_monnaie_id(db_session)
    _depense(db_session, compte, 300.0, date(2026, 9, 3), categorie="Loisirs & sorties")
    _depense(db_session, compte, 100.0, date(2026, 9, 5), categorie="Alimentaire")

    total = sum(
        b["total_reel"] for b in soldes.get_depenses_par_categorie(db_session, 2026, 9, m)
    )
    objectif = _objectif(
        db_session,
        mesure="part_depenses",
        sens="max",
        cible=50.0,
        categorie_id=get_categorie_id(db_session, "Loisirs & sorties"),
    )
    mesure = service.mesurer(db_session, objectif, 2026, 9, date(2026, 12, 31))

    assert mesure["valeur"] == pytest.approx(300.0 / total * 100.0)
    # Une part ne se convertit pas non plus : 75 % sur la moitié du mois reste
    # 75 %, et non 37,5.
    assert mesure["mode"] == "cumul"
    assert mesure["valeur_cadence"] == pytest.approx(mesure["valeur"])
    assert mesure["atteint"] is False


def test_sans_categorie_l_objectif_porte_sur_toutes_les_depenses(db_session, compte):
    """NULL VEUT DIRE « TOUTES », ET NON « AUCUNE ». « Pas plus de 30 achats par
    mois, tous postes confondus » est un objectif aussi légitime qu'un objectif
    par catégorie, et l'interdire aurait obligé à inventer une catégorie
    fourre-tout pour l'exprimer."""
    _depense(db_session, compte, 50.0, date(2026, 10, 2), categorie="Alimentaire")
    _depense(db_session, compte, 70.0, date(2026, 10, 6), categorie="Loisirs & sorties")

    objectif = _objectif(db_session, mesure="nombre", cible=5.0, categorie_id=None)
    mesure = service.mesurer(db_session, objectif, 2026, 10, date(2026, 12, 31))
    assert mesure["valeur"] == pytest.approx(2.0)


# ---------- Le sens, et ce qu'il colore ----------


def test_un_plancher_et_un_plafond_ne_se_jugent_pas_pareil(db_session, compte):
    """SANS LE SENS, la couleur de la barre — tout ce qu'on lit d'un coup d'œil —
    dirait n'importe quoi une fois sur deux."""
    _depense(db_session, compte, 100.0, date(2026, 11, 4))

    plafond = _objectif(db_session, mesure="montant_total", sens="max", cible=200.0)
    plancher = _objectif(db_session, mesure="montant_total", sens="min", cible=200.0)

    quand = date(2026, 12, 31)
    assert service.mesurer(db_session, plafond, 2026, 11, quand)["atteint"] is True
    assert service.mesurer(db_session, plancher, 2026, 11, quand)["atteint"] is False


def test_une_cible_a_zero_se_lit_sans_diviser_par_zero(db_session, compte):
    """« AUCUNE SORTIE CE MOIS-CI » EST UN OBJECTIF. La barre est vide tant qu'on
    n'a rien fait, pleine dès la première ligne — il n'y a pas de demi-mesure à
    afficher, et surtout pas de division à faire."""
    objectif = _objectif(db_session, mesure="nombre", cible=0.0, sens="max")
    vide = service.mesurer(db_session, objectif, 2026, 11, date(2026, 12, 31))
    assert vide["avancement"] == 0.0
    assert vide["atteint"] is True

    _depense(db_session, compte, 10.0, date(2026, 11, 8))
    franchi = service.mesurer(db_session, objectif, 2026, 11, date(2026, 12, 31))
    assert franchi["avancement"] == 100.0
    assert franchi["atteint"] is False


# ---------- La promesse : l'extension ne change rien ----------


def test_les_objectifs_ne_changent_aucun_chiffre_du_noyau(db_session, compte):
    """CE QUI PERMET DE L'ÉTEINDRE SANS CONSÉQUENCE. Un objectif REGARDE ; il ne
    crée, ne modifie et ne supprime aucune opération, et aucun calcul du noyau ne
    le lit."""
    m = get_monnaie_id(db_session)
    _depense(db_session, compte, 120.0, date(2026, 2, 5))
    avant = {
        "flux": soldes.get_flux_periode(db_session, 2026, 2, m),
        "barres": soldes.get_depenses_par_categorie(db_session, 2026, 2, m),
        "comptes": [
            (item["compte"].id, item["soldes"]) for item in soldes.get_soldes_comptes(db_session)
        ],
    }

    for index in range(10):
        _objectif(db_session, nom=f"Objectif {index}", cible=float(index))

    assert soldes.get_flux_periode(db_session, 2026, 2, m) == avant["flux"]
    assert soldes.get_depenses_par_categorie(db_session, 2026, 2, m) == avant["barres"]
    assert [
        (item["compte"].id, item["soldes"]) for item in soldes.get_soldes_comptes(db_session)
    ] == avant["comptes"]


def test_supprimer_une_categorie_elargit_l_objectif_au_lieu_de_l_emporter(
    db_session, compte
):
    """SET NULL, ET NON CASCADE. Supprimer une catégorie est un geste fait
    ailleurs et sans rapport : il ne doit pas faire disparaître en silence un
    objectif qu'on avait écrit."""
    categorie_id = get_categorie_id(db_session, "Vêtements & équipement sport")
    objectif = _objectif(db_session, categorie_id=categorie_id)

    crud.delete_categorie(db_session, db_session.get(models.Categorie, categorie_id))
    db_session.expire_all()

    survivant = db_session.get(models.ObjectifKpi, objectif.id)
    assert survivant is not None
    assert survivant.categorie_id is None


# ---------- Les deux gardes du routeur ----------


def test_une_part_sans_categorie_est_refusee(db_session):
    """ELLE VAUDRAIT 100 % TOUS LES MOIS. Sans catégorie, une part rapporte
    TOUTES les dépenses au total des dépenses : l'objectif ne peut jamais
    bouger, quoi qu'on dépense. Le refuser coûte une phrase ; le laisser passer
    coûte la confiance qu'on met dans les trois autres mesures."""
    with pytest.raises(HTTPException) as erreur:
        routeur.creer_objectif(
            schemas_obj.ObjectifCreate(
                nom="Part de tout",
                mesure="part_depenses",
                cible=20.0,
                monnaie_id=get_monnaie_id(db_session),
            ),
            db=db_session,
        )
    assert erreur.value.status_code == 400

    # Et le même refus par l'autre chemin : retirer la catégorie d'une part
    # déjà écrite mène au même objectif impossible.
    vivant = routeur.creer_objectif(
        schemas_obj.ObjectifCreate(
            nom="Part des loisirs",
            mesure="part_depenses",
            cible=20.0,
            categorie_id=get_categorie_id(db_session, "Loisirs & sorties"),
            monnaie_id=get_monnaie_id(db_session),
        ),
        db=db_session,
    )
    with pytest.raises(HTTPException) as erreur:
        routeur.modifier_objectif(
            vivant.id, schemas_obj.ObjectifUpdate(categorie_id=0), db=db_session
        )
    assert erreur.value.status_code == 400


def test_un_objectif_neuf_va_en_fin_de_liste(db_session):
    """SINON ON LE CHERCHE. Le défaut du schéma est zéro, qui l'aurait glissé au
    MILIEU des objectifs déjà là — et le geste suivant, relire ce qu'on vient
    d'écrire, devient une chasse."""
    monnaie_id = get_monnaie_id(db_session)
    noms = ["Premier", "Deuxième", "Troisième"]
    for nom in noms:
        routeur.creer_objectif(
            schemas_obj.ObjectifCreate(
                nom=nom, mesure="nombre", cible=3.0, monnaie_id=monnaie_id
            ),
            db=db_session,
        )
    assert [o.nom for o in routeur.lister_objectifs(db=db_session)] == noms


# ---------- Le troisième périmètre : un PROJET (migration 0070) ----------


def _projet(db_session, nom, operations):
    """Un projet, et les opérations qu'on y verse.

    PAS UNE CATÉGORIE : le lien est MULTIPLE (table `operation_sous_filtre`) et
    aucun calcul du noyau ne le lit — le total d'un projet est une somme
    affichée (cf. models.SousFiltre)."""
    projet = models.SousFiltre(nom=nom)
    projet.operations.extend(operations)
    db_session.add(projet)
    db_session.commit()
    db_session.refresh(projet)
    return projet


def test_un_objectif_peut_porter_sur_un_projet(db_session, compte):
    """CE QU'UN PROJET APPORTE ET QU'UNE CATÉGORIE NE SAIT PAS DIRE : un voyage
    traverse les catégories (le train, l'hôtel, les courses) et n'existe qu'en
    tant qu'ÉVÉNEMENT. Son total se lisait sur la page des projets, c'est-à-dire
    partout sauf là où l'on se demande où l'on en est."""
    train = _depense(db_session, compte, 120.0, date(2026, 5, 4), categorie="Alimentaire")
    hotel = _depense(db_session, compte, 380.0, date(2026, 5, 6))
    _depense(db_session, compte, 90.0, date(2026, 5, 9))  # hors projet
    projet = _projet(db_session, "Italie", [train, hotel])

    objectif = _objectif(
        db_session,
        mesure="montant_total",
        cadence="mois",
        cible=600.0,
        sous_filtre_id=projet.id,
    )
    mesure = service.mesurer(db_session, objectif, 2026, 5, date(2026, 12, 31))

    assert mesure["projet"] == "Italie"
    assert mesure["valeur"] == pytest.approx(500.0)
    assert mesure["atteint"] is True


def test_la_part_dun_projet_se_rapporte_aux_memes_lignes_que_lui(db_session, compte):
    """LE DÉNOMINATEUR SE COMPTE COMME LE NUMÉRATEUR. Rapporter un total de
    LIGNES à un total ÉTALÉ aurait permis à un projet de peser plus de 100 % du
    mois, ce qu'aucun des deux chiffres ne dit."""
    hotel = _depense(db_session, compte, 300.0, date(2026, 5, 6))
    _depense(db_session, compte, 100.0, date(2026, 5, 9))
    projet = _projet(db_session, "Italie", [hotel])

    objectif = _objectif(
        db_session,
        mesure="part_depenses",
        cible=50.0,
        sous_filtre_id=projet.id,
    )
    mesure = service.mesurer(db_session, objectif, 2026, 5, date(2026, 12, 31))

    assert mesure["valeur"] == pytest.approx(75.0)
    assert mesure["atteint"] is False


def test_une_operation_hors_periode_ne_compte_pas_dans_le_projet(db_session, compte):
    """UN PROJET N'A PAS DE DATES : ce sont celles de ses opérations, et la
    période affichée les filtre comme elle filtre tout le reste. Un voyage à
    cheval sur deux mois se lit donc mois par mois au dashboard, et en entier
    sur sa page."""
    mai = _depense(db_session, compte, 200.0, date(2026, 5, 20))
    juin = _depense(db_session, compte, 150.0, date(2026, 6, 2))
    projet = _projet(db_session, "Italie", [mai, juin])

    objectif = _objectif(
        db_session, mesure="montant_total", sous_filtre_id=projet.id, cible=1000.0
    )
    assert service.mesurer(db_session, objectif, 2026, 5, date(2026, 12, 31))[
        "valeur"
    ] == pytest.approx(200.0)
    assert service.mesurer(db_session, objectif, 2026, None, date(2026, 12, 31))[
        "valeur"
    ] == pytest.approx(350.0)


def test_un_objectif_ne_porte_pas_les_deux_perimetres(db_session, compte):
    """UNE CATÉGORIE OU UN PROJET, JAMAIS LES DEUX. Les deux axes se croisent —
    l'hôtel d'un voyage est dans « Loisirs » ET dans « Italie » — et porter les
    deux poserait une question dont aucune réponse ne s'impose : l'intersection,
    ou l'union ?"""
    projet = _projet(db_session, "Italie", [])
    with pytest.raises(HTTPException) as erreur:
        routeur.creer_objectif(
            schemas_obj.ObjectifCreate(
                nom="Les deux",
                mesure="montant_total",
                cible=100.0,
                categorie_id=get_categorie_id(db_session, "Loisirs & sorties"),
                sous_filtre_id=projet.id,
                monnaie_id=get_monnaie_id(db_session),
            ),
            db=db_session,
        )
    assert erreur.value.status_code == 400


def test_ecrire_un_perimetre_efface_lautre(db_session, compte):
    """L'EXCLUSION EST UNE RÈGLE, PAS UN PIÈGE. Demander à l'écran d'envoyer le
    zéro de l'un en même temps que l'autre aurait fait échouer, en 400, le geste
    le plus ordinaire : changer d'avis sur ce qu'on regarde."""
    projet = _projet(db_session, "Italie", [])
    objectif = routeur.creer_objectif(
        schemas_obj.ObjectifCreate(
            nom="Loisirs",
            mesure="montant_total",
            cible=100.0,
            categorie_id=get_categorie_id(db_session, "Loisirs & sorties"),
            monnaie_id=get_monnaie_id(db_session),
        ),
        db=db_session,
    )
    modifie = routeur.modifier_objectif(
        objectif.id,
        schemas_obj.ObjectifUpdate(sous_filtre_id=projet.id),
        db=db_session,
    )
    assert modifie.sous_filtre_id == projet.id
    assert modifie.categorie_id is None


# ---------- Un objectif sans cible (migration 0070) ----------


def test_sans_cible_rien_nest_tenu_ni_manque(db_session, compte):
    """SUIVRE SANS SE FIXER DE RÈGLE. C'est l'état ordinaire d'un projet qu'on
    commence : on veut voir ce qu'il coûte bien avant de savoir ce qu'on
    s'autorise. Prononcer « tenu » ou « manqué » sur une règle que personne ne
    s'est donnée aurait été un jugement inventé."""
    _depense(db_session, compte, 420.0, date(2026, 5, 6))
    objectif = _objectif(db_session, mesure="montant_total", cible=None)
    mesure = service.mesurer(db_session, objectif, 2026, 5, date(2026, 12, 31))

    assert mesure["cible"] is None
    assert mesure["valeur"] == pytest.approx(420.0)
    # La barre ne se remplit pas : il n'y a pas de bout à atteindre.
    assert mesure["avancement"] == 0.0
    # `atteint` reste vrai pour que rien ne se peigne en rouge — c'est
    # `cible is None` qui dit à l'écran de ne rien dessiner du tout.
    assert mesure["atteint"] is True


def test_zero_reste_une_cible_a_part_entiere(db_session, compte):
    """ZÉRO N'EST PAS « PAS DE CIBLE ». « Aucune sortie ce mois-ci » est une
    règle, et une règle sévère : la première ligne la fait manquer."""
    _depense(db_session, compte, 12.0, date(2026, 5, 6))
    objectif = _objectif(db_session, mesure="montant_total", cible=0.0)
    mesure = service.mesurer(db_session, objectif, 2026, 5, date(2026, 12, 31))

    assert mesure["cible"] == 0.0
    assert mesure["atteint"] is False
    assert mesure["avancement"] == 100.0


def test_la_cible_ne_se_retire_que_par_cible_effacee(db_session):
    """`None` VEUT DÉJÀ DIRE « NE CHANGE PAS » sur tous les champs, et zéro est
    une cible : il fallait donc une troisième façon de dire « je ne me fixe plus
    rien »."""
    objectif = routeur.creer_objectif(
        schemas_obj.ObjectifCreate(
            nom="Voyage",
            mesure="montant_total",
            cible=2000.0,
            monnaie_id=get_monnaie_id(db_session),
        ),
        db=db_session,
    )
    inchange = routeur.modifier_objectif(
        objectif.id, schemas_obj.ObjectifUpdate(nom="Voyage 2026"), db=db_session
    )
    assert inchange.cible == pytest.approx(2000.0)

    efface = routeur.modifier_objectif(
        objectif.id, schemas_obj.ObjectifUpdate(cible_effacee=True), db=db_session
    )
    assert efface.cible is None


def test_sans_monnaie_les_mesures_les_rendent_tous(db_session, compte):
    """LA PAGE DES OBJECTIFS LES MONTRE TOUS, chacun mesuré dans SA monnaie, et
    n'additionne rien pour autant — ce sont des cartes, pas un total. Un onglet
    de monnaie y cachait la moitié de la liste à qui tient deux devises, sans
    que rien ne le dise."""
    euro = get_monnaie_id(db_session)
    dollar = models.Monnaie(nom="Dollar", symbole="$")
    db_session.add(dollar)
    db_session.commit()

    _objectif(db_session, nom="En euros", monnaie_id=euro)
    _objectif(db_session, nom="En dollars", monnaie_id=dollar.id)

    tous = service.mesurer_tous(db_session, 2026, 5, None, aujourdhui=date(2026, 12, 31))
    assert sorted(m["nom"] for m in tous) == ["En dollars", "En euros"]

    euros_seuls = service.mesurer_tous(
        db_session, 2026, 5, euro, aujourdhui=date(2026, 12, 31)
    )
    assert [m["nom"] for m in euros_seuls] == ["En euros"]
