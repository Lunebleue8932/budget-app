"""Cours lus en ligne : reconnaître une page, en tirer un nombre, l'écrire.

AUCUN TEST NE SORT SUR LE RÉSEAU. Les pages sont des extraits figés du vrai
HTML (Google, Boursorama) et du vrai JSON (Yahoo), et `telecharger` est
détourné : une suite de tests qui dépendrait de la Bourse de Paris échouerait
le week-end, lentement, et pour une raison qui n'a rien à voir avec le code.

CE QUI EST VÉRIFIÉ EN PRIORITÉ, ce sont les façons de se tromper SANS QUE ÇA SE
VOIE — un nombre plausible écrit au mauvais endroit :

  - lire le cours d'un autre instrument de la page (Google et Boursorama en
    affichent une dizaine, bandeaux et colonnes de suggestions) ;
  - lire le cours de la bonne société sur la mauvaise place de cotation ;
  - écrire un cours en dollars sur un titre coté en euros ;
  - écrire des pence (« GBX », « GBp ») comme si c'étaient des livres, soit
    cent fois trop.

Un échec bruyant, lui, se corrige tout seul : l'utilisateur le voit.
"""
from datetime import datetime

import pytest
from fastapi import HTTPException

from app import crud, models

from .conftest import charger_module_extension, get_monnaie_id

# Le point d'entrée de l'extension est chargé PAR CHEMIN, comme le fait
# l'application (cf. app/extensions.py::charger_routeur) : c'est lui qui met le
# dossier de l'extension sur le `sys.path`, après quoi ses modules s'importent
# entre eux par leur nom — exactement comme en fonctionnement.
#
# LES TROIS IMPORTS QUI SUIVENT DOIVENT PASSER PAR LÀ. Charger chacun par
# chemin en créerait une SECONDE copie, distincte de celle que `routeur_cours`
# utilise réellement : les tests détourneraient alors une fonction que le code
# testé n'appelle jamais, et passeraient en ne vérifiant rien.
charger_module_extension("placements-web", "backend.py")

import routeur_cours  # noqa: E402
import service_cours  # noqa: E402
import source_cours  # noqa: E402


# ---------- Pages figées ----------

# Extrait réel d'une page action Boursorama : le bandeau du haut (un indice),
# puis le bloc de l'instrument de la page. C'est exactement le piège que
# l'extraction doit éviter — le premier `data-ist-init` n'est PAS le bon.
PAGE_BOURSORAMA = """
<html><body>
  <div data-ist-init="{&quot;symbol&quot;:&quot;$INDU&quot;,&quot;last&quot;:53277.01}"></div>
  <div class="c-faceplate" data-faceplate-symbol="1rPAI"
       data-ist-init="{&quot;symbol&quot;:&quot;1rPAI&quot;,&quot;last&quot;:167.12,&quot;tradeDate&quot;:&quot;2026-08-21 17:36:19&quot;}">
    <a class="c-faceplate__company-link" href="/cours/1rPAI/">
                AIR LIQUIDE
            </a>
    <div class="c-faceplate__price "><span class="c-instrument c-instrument--last"
      data-ist-last>167,120</span><span class="c-faceplate__price-currency"> EUR</span></div>
  </div>
  <script type="application/ld+json">
    {"@context":"http://schema.org","@type":"Product","name":"AIR LIQUIDE",
     "offers":{"@type":"Offer","price":167.12,"priceCurrency":"EUR"}}
  </script>
</body></html>
"""

# Un tracker : pas de balisage schema.org (Boursorama n'en met que sur les
# actions), donc seul le bloc `data-ist-init` permet de lire le cours.
PAGE_BOURSORAMA_TRACKER = """
<html><body>
  <div data-ist-init="{&quot;symbol&quot;:&quot;1xN225&quot;,&quot;last&quot;:66016.36}"></div>
  <div class="c-faceplate" data-faceplate-symbol="1rTCW8"
       data-ist-init="{&quot;symbol&quot;:&quot;1rTCW8&quot;,&quot;last&quot;:688.01}">
    <a class="c-faceplate__company-link" href="/x">Amundi MSCI World</a>
    <div class="c-faceplate__price"><span class="c-faceplate__price-currency"> EUR</span></div>
  </div>
</body></html>
"""

# Extrait réel d'une page Google Finance : le bloc de l'instrument porte
# `data-last-price`, les valeurs de la colonne de droite portent `data-price`.
# C'est cette asymétrie que l'extraction exploite — et le second bloc ci-dessous
# est là pour vérifier qu'on ne rapporte pas le cours du voisin.
PAGE_GOOGLE = """
<html><body>
  <div role="heading" aria-level="1" class="zzDege">Air Liquide</div>
  <div jscontroller="NdbN0c" data-mid="/g/1dv1hvhd" data-exchange="EPA"
       data-currency-code="EUR" data-last-price="167.12" data-tz-offset=7200000>
    <div class="YMlKec fxKbKc">167,12&nbsp;€</div>
  </div>
  <div jsname="UEIKff" data-symbol="ENGI" data-exchange="EPA" data-name="Engie"
       data-currency-code="EUR" data-price="25.13"></div>
</body></html>
"""

# Londres cote en PENCE, et Google l'annonce « GBX ». Le nombre est plausible,
# et cent fois trop grand pour un titre libellé en livres.
PAGE_GOOGLE_LONDRES = """
<html><body>
  <div role="heading" aria-level="1">HSBC</div>
  <div data-exchange="LON" data-currency-code="GBX" data-last-price="1518.4"></div>
</body></html>
"""

JSON_YAHOO = """
{"chart":{"result":[{"meta":{"symbol":"AI.PA","currency":"EUR",
 "regularMarketPrice":167.12,"longName":"L'Air Liquide S.A."}}],"error":null}}
"""


@pytest.fixture()
def sans_reseau(monkeypatch):
    """Détourne le téléchargement : chaque test dit ce que « la page » contient.

    Posé sur le module `source_cours` lui-même : les extracteurs l'appellent
    par son nom de module, c'est donc là que la substitution doit avoir lieu.
    """
    pages = {}

    def faux_telecharger(url):
        for fragment, contenu in pages.items():
            if fragment in url:
                if isinstance(contenu, Exception):
                    raise contenu
                return contenu
        raise AssertionError(f"URL non prévue par le test : {url}")

    monkeypatch.setattr(source_cours, "telecharger", faux_telecharger)
    return pages


# ---------- Reconnaissance des sources ----------


def test_chaque_lien_va_vers_la_source_qui_sait_le_lire():
    assert (
        source_cours.source_de("https://www.google.com/finance/quote/AI:EPA")["id"]
        == "google"
    )
    # Le CHEMIN compte autant que le domaine : google.com sert surtout autre
    # chose, et une page de recherche n'a aucun cours à donner.
    assert (
        source_cours.source_de("https://www.google.com/search?q=air+liquide")["id"]
        == "schema.org"
    )
    assert source_cours.source_de("https://finance.yahoo.com/quote/AI.PA")["id"] == "yahoo"
    assert source_cours.source_de("https://www.boursorama.com/cours/1rPAI/")["id"] == "boursorama"
    # Tout le reste tombe dans le filet schema.org : une source inconnue n'est
    # pas refusée d'avance, elle est essayée.
    assert source_cours.source_de("https://exemple.fr/action/xyz")["id"] == "schema.org"


def test_un_lien_qui_nest_pas_une_page_web_est_refuse():
    """`file://` lirait un fichier de la machine : un champ qui attend l'adresse
    d'une page de cotation n'a aucune raison de l'accepter."""
    for url in ("file:///C:/Windows/win.ini", "ftp://exemple.fr/x", "pas une url"):
        with pytest.raises(source_cours.CoursIllisible):
            source_cours.lire_cours(url)


# ---------- Extraction ----------


def test_yahoo_rend_le_cours_la_devise_et_le_nom(sans_reseau):
    sans_reseau["query1.finance.yahoo.com"] = JSON_YAHOO

    cours = source_cours.lire_cours("https://finance.yahoo.com/quote/AI.PA")

    assert cours.valeur == 167.12
    assert cours.devise == "EUR"
    assert cours.libelle == "L'Air Liquide S.A."
    assert cours.source == "yahoo"


def test_yahoo_lit_lapi_et_non_la_page(monkeypatch):
    """La page `finance.yahoo.com/quote/...` n'a pas son cours dans son HTML
    (il est écrit par du JavaScript) : c'est l'API du graphique qui est
    appelée, avec le symbole tiré du lien collé."""
    appelees = []

    def espion(url):
        appelees.append(url)
        return JSON_YAHOO

    monkeypatch.setattr(source_cours, "telecharger", espion)

    source_cours.lire_cours("https://finance.yahoo.com/quote/CW8.PA/")

    assert appelees == [
        "https://query1.finance.yahoo.com/v8/finance/chart/CW8.PA?range=1d&interval=1d"
    ]


def test_google_rend_le_cours_la_devise_et_le_nom(sans_reseau):
    """Le cours vient de `data-last-price` et non du texte affiché : « 167,12 €
    » dépend de la langue du visiteur, l'attribut non."""
    sans_reseau["google.com"] = PAGE_GOOGLE

    cours = source_cours.lire_cours("https://www.google.com/finance/quote/AI:EPA")

    assert cours.valeur == 167.12
    assert cours.devise == "EUR"
    assert cours.libelle == "Air Liquide"
    assert cours.source == "google"


def test_google_ne_prend_pas_le_cours_de_la_colonne_de_droite(sans_reseau):
    """Une page Google affiche une dizaine d'autres valeurs. Elles portent
    `data-price` là où l'instrument de la page porte `data-last-price` : c'est
    cette asymétrie qui rend l'ancre sûre, pas l'ordre d'apparition."""
    sans_reseau["google.com"] = PAGE_GOOGLE

    cours = source_cours.lire_cours("https://www.google.com/finance/quote/AI:EPA")

    assert cours.valeur != 25.13


def test_google_verifie_la_place_de_cotation(sans_reseau):
    """Le lien dit « NASDAQ », la page répond « EPA » : on refuse de lire
    plutôt que d'écrire le cours d'un autre instrument."""
    sans_reseau["google.com"] = PAGE_GOOGLE

    with pytest.raises(source_cours.CoursIllisible) as erreur:
        source_cours.lire_cours("https://www.google.com/finance/quote/AI:NASDAQ")

    assert "ne publie pas de cours" in str(erreur.value)


def test_google_accepte_un_lien_sans_place_de_cotation(sans_reseau):
    """Les cryptomonnaies s'écrivent « BTC-EUR », sans place : il n'y a alors
    rien à vérifier, et le seul bloc de la page est le bon."""
    sans_reseau["google.com"] = """
      <html><body><div data-last-price="65891.72"></div></body></html>
    """

    cours = source_cours.lire_cours("https://www.google.com/finance/quote/BTC-EUR")

    assert cours.valeur == 65891.72
    assert cours.devise is None  # Google n'en publie pas pour les cryptos


def test_google_le_dit_quand_le_titre_est_inconnu(sans_reseau):
    """Un symbole inexistant rend une page 200 sans cours : sans ce contrôle,
    la lecture échouerait sur une erreur technique au lieu d'un conseil."""
    sans_reseau["google.com"] = "<html><body><p>Rien ici</p></body></html>"

    with pytest.raises(source_cours.CoursIllisible) as erreur:
        source_cours.lire_cours("https://www.google.com/finance/quote/NEXISTEPAS:EPA")

    assert "vérifie le symbole" in str(erreur.value)


def test_boursorama_ne_prend_pas_le_cours_dun_autre_instrument(sans_reseau):
    """LE PIÈGE PRINCIPAL. Une page Boursorama affiche le CAC, le Dow et les
    tickers du bandeau : prendre le premier cours venu donnerait 53 277 pour
    Air Liquide, un nombre plausible pour un indice et absurde pour une
    action — mais que rien à l'écran ne signalerait."""
    sans_reseau["boursorama.com"] = PAGE_BOURSORAMA

    cours = source_cours.lire_cours("https://www.boursorama.com/cours/1rPAI/")

    assert cours.valeur == 167.12
    assert cours.devise == "EUR"
    assert cours.libelle == "AIR LIQUIDE"


def test_boursorama_lit_aussi_un_tracker_sans_balisage_schema_org(sans_reseau):
    sans_reseau["boursorama.com"] = PAGE_BOURSORAMA_TRACKER

    cours = source_cours.lire_cours(
        "https://www.boursorama.com/bourse/trackers/cours/1rTCW8/"
    )

    assert cours.valeur == 688.01


def test_une_page_sans_cours_lisible_le_dit(sans_reseau):
    sans_reseau["exemple.fr"] = "<html><body><p>Bonjour</p></body></html>"

    with pytest.raises(source_cours.CoursIllisible) as erreur:
        source_cours.lire_cours("https://exemple.fr/action/xyz")

    assert "Aucun cours lisible" in str(erreur.value)


def test_les_deux_ecritures_dun_nombre_sont_lues(sans_reseau):
    """« 8 484,43 » à Paris, « 8,484.43 » à New York : c'est le séparateur le
    plus à droite qui est décimal, dans les deux cas."""
    assert source_cours.nombre_ecrit("8 484,43") == 8484.43
    assert source_cours.nombre_ecrit("8,484.43") == 8484.43
    assert source_cours.nombre_ecrit("167,120") == 167.12
    assert source_cours.nombre_ecrit("1 234 €") == 1234.0


def test_un_cours_nul_ou_negatif_est_refuse(sans_reseau):
    """Zéro n'est pas un cours : c'est le signe qu'on a lu autre chose (un
    volume, une variation). La base refuse d'ailleurs les valeurs négatives."""
    sans_reseau["exemple.fr"] = """
      <script type="application/ld+json">
        {"@type":"Product","name":"X","offers":{"price":0,"priceCurrency":"EUR"}}
      </script>
    """
    with pytest.raises(source_cours.CoursIllisible):
        source_cours.lire_cours("https://exemple.fr/x")


# ---------- Devises ----------


def _monnaie(db, nom):
    return db.query(models.Monnaie).filter(models.Monnaie.nom == nom).one()


def test_un_cours_dans_une_autre_monnaie_est_refuse(db_session):
    """Un titre coté en euros valorisé avec un cours en dollars donnerait une
    plus-value fausse d'un tiers, sans rien afficher d'anormal."""
    euro = _monnaie(db_session, "Euro")
    cours = source_cours.Cours(valeur=100.0, devise="USD")

    message = service_cours.ecart_de_devise(cours, euro)

    assert message is not None and "USD" in message


def test_les_pence_ne_passent_pas_pour_des_livres(db_session):
    """LE FACTEUR CENT. Yahoo publie Londres en « GBp » — des pence. Passer le
    code en majuscules le confondrait avec « GBP » et multiplierait la
    valorisation par cent, sur un titre par ailleurs correctement réglé."""
    livre = crud.create_monnaie(db_session, "Livre sterling", "£")
    cours = source_cours.Cours(valeur=950.0, devise="GBp")

    assert service_cours.normaliser_devise("GBp") == "GBp"
    assert service_cours.ecart_de_devise(cours, livre) is not None


def test_le_cours_de_londres_est_refuse_avec_le_bon_mot(db_session, sans_reseau):
    """Bout en bout, sur la vraie forme de page. Le message doit NOMMER les
    pence et donner la conversion : « le cours lu est en GBX » n'apprend rien à
    qui vient de coller la page d'une action britannique et la voit refusée."""
    sans_reseau["google.com"] = PAGE_GOOGLE_LONDRES
    livre = crud.create_monnaie(db_session, "Livre sterling", "£")

    cours = source_cours.lire_cours("https://www.google.com/finance/quote/HSBA:LON")
    message = service_cours.ecart_de_devise(cours, livre)

    assert cours.valeur == 1518.4
    assert "pence" in message and "15.184" in message


def test_une_monnaie_ambigue_ne_bloque_rien(db_session):
    """« $ » désigne aussi bien le dollar américain que le canadien : refuser
    un cours sur cette devinette serait pire que ne rien vérifier."""
    dollar = crud.create_monnaie(db_session, "Dollar", "$")
    cours = source_cours.Cours(valeur=100.0, devise="USD")

    assert service_cours.ecart_de_devise(cours, dollar) is None


def test_une_source_muette_sur_la_devise_ne_bloque_rien(db_session):
    euro = _monnaie(db_session, "Euro")

    assert service_cours.ecart_de_devise(source_cours.Cours(valeur=10.0), euro) is None


# ---------- Le service : ce qui est écrit, et ce qui ne l'est pas ----------


def _titre(db, nom="Air Liquide", valeur=1.0, url=None):
    action = crud.create_action(db, nom, get_monnaie_id(db), valeur)
    if url:
        crud.definir_url_cours(db, action, url)
    return action


def test_seuls_les_titres_avec_un_lien_sont_relus(db_session):
    """Un cours saisi à la main n'est pas un échec : il n'est pas concerné.
    L'extension s'ajoute au réglage manuel, elle ne le remplace pas."""
    _titre(db_session, "À la main", valeur=42.0)
    suivi = _titre(db_session, "Suivi", url="https://exemple.fr/x")

    suivis = service_cours.titres_suivis(db_session)

    assert [action.id for action in suivis] == [suivi.id]


def test_un_rafraichissement_ecrit_le_cours_et_date_la_lecture(db_session, monkeypatch):
    action = _titre(db_session, valeur=10.0, url="https://exemple.fr/x")
    monkeypatch.setattr(
        service_cours,
        "lire_cours",
        lambda url: source_cours.Cours(valeur=167.12, devise="EUR", source="test"),
    )

    resume = service_cours.rafraichir(db_session, [action])

    assert resume.reussis == 1 and resume.echecs == 0
    assert resume.resultats[0].ancien_cours == 10.0
    assert action.valeur == 167.12
    assert isinstance(action.cours_maj_le, datetime)


def test_un_lot_porte_un_seul_horodatage(db_session, monkeypatch):
    """Dix titres relus d'un même clic portent la même date : c'est le geste
    qu'elle raconte, pas l'ordre d'exécution du code."""
    actions = [
        _titre(db_session, f"Titre {i}", url=f"https://exemple.fr/{i}") for i in range(3)
    ]
    monkeypatch.setattr(
        service_cours, "lire_cours", lambda url: source_cours.Cours(valeur=5.0)
    )

    service_cours.rafraichir(db_session, actions)

    assert len({action.cours_maj_le for action in actions}) == 1


def test_un_titre_en_echec_nempeche_pas_les_autres(db_session, monkeypatch):
    """Le cas normal n'est pas « tout marche » : dix titres, trois sources, une
    connexion qui peut tomber. Tout annuler pour un lien mort priverait
    l'utilisateur de neuf cours frais."""
    bon = _titre(db_session, "Bon", valeur=1.0, url="https://exemple.fr/ok")
    casse = _titre(db_session, "Cassé", valeur=2.0, url="https://exemple.fr/ko")

    def lecture(url):
        if url.endswith("ko"):
            raise source_cours.CoursIllisible("La page n'existe pas (404)")
        return source_cours.Cours(valeur=99.0)

    monkeypatch.setattr(service_cours, "lire_cours", lecture)

    resume = service_cours.rafraichir(db_session, [bon, casse])

    assert (resume.reussis, resume.echecs) == (1, 1)
    assert bon.valeur == 99.0
    # Le cours du titre en échec n'est ni effacé ni remis à zéro : le dernier
    # cours connu reste la meilleure information disponible.
    assert casse.valeur == 2.0
    assert casse.cours_maj_le is None


def test_un_cours_dans_la_mauvaise_monnaie_nest_pas_ecrit(db_session, monkeypatch):
    action = _titre(db_session, valeur=10.0, url="https://exemple.fr/x")
    monkeypatch.setattr(
        service_cours,
        "lire_cours",
        lambda url: source_cours.Cours(valeur=200.0, devise="USD"),
    )

    resume = service_cours.rafraichir(db_session, [action])

    assert resume.echecs == 1
    assert action.valeur == 10.0  # inchangé


def test_une_source_qui_leve_nimporte_quoi_ne_casse_pas_le_lot(db_session, monkeypatch):
    """Un site hostile (HTML piégé, JSON monstrueux) ne doit pas remonter une
    exception technique jusqu'à l'écran, ni interrompre les autres lectures."""
    action = _titre(db_session, url="https://exemple.fr/x")

    def explose(url):
        raise RecursionError("boum")

    monkeypatch.setattr(service_cours, "lire_cours", explose)

    resume = service_cours.rafraichir(db_session, [action])

    assert resume.echecs == 1
    assert "RecursionError" in resume.resultats[0].erreur


# ---------- Les routes ----------


def test_enregistrer_un_lien_le_lit_tout_de_suite(db_session, monkeypatch):
    """Un lien accepté sans être essayé ne se découvre cassé que des semaines
    plus tard, devant un cours qu'on croit juste."""
    action = _titre(db_session, valeur=1.0)
    monkeypatch.setattr(
        source_cours,
        "lire_cours",
        lambda url: source_cours.Cours(
            valeur=167.12, devise="EUR", libelle="AIR LIQUIDE", source="boursorama"
        ),
    )

    reponse = routeur_cours.definir_url(
        action.id,
        type("Payload", (), {"url": " https://www.boursorama.com/cours/1rPAI/ "})(),
        db_session,
    )

    assert reponse.reussis == 1
    assert reponse.resultats[0].libelle_source == "AIR LIQUIDE"
    assert action.valeur == 167.12
    # Espaces rognés : un lien collé traîne souvent un blanc en fin de chaîne.
    assert action.url_cours == "https://www.boursorama.com/cours/1rPAI/"


def test_un_lien_illisible_nest_pas_enregistre(db_session, monkeypatch):
    action = _titre(db_session, valeur=1.0)
    monkeypatch.setattr(
        source_cours,
        "lire_cours",
        lambda url: (_ for _ in ()).throw(source_cours.CoursIllisible("Site injoignable")),
    )

    with pytest.raises(HTTPException) as erreur:
        routeur_cours.definir_url(
            action.id, type("Payload", (), {"url": "https://exemple.fr/x"})(), db_session
        )

    assert erreur.value.status_code == 400
    assert action.url_cours is None
    assert action.valeur == 1.0


def test_detacher_un_lien_garde_le_dernier_cours(db_session):
    """Un cours ne devient pas faux parce qu'on cesse de le rafraîchir : le
    titre retombe simplement dans le régime manuel."""
    action = _titre(db_session, valeur=167.12, url="https://exemple.fr/x")

    routeur_cours.retirer_url(action.id, db_session)

    assert action.url_cours is None
    assert action.valeur == 167.12


def test_rafraichir_un_titre_sans_lien_est_refuse(db_session):
    action = _titre(db_session)

    with pytest.raises(HTTPException) as erreur:
        routeur_cours.rafraichir_titre(action.id, db_session)

    assert erreur.value.status_code == 400


def test_la_reponse_porte_letat_de_tous_les_titres(db_session, monkeypatch):
    """L'écran doit pouvoir se remettre à jour sans second aller-retour, sinon
    il afficherait un instant des cours périmés à côté d'un message annonçant
    qu'ils viennent de changer."""
    _titre(db_session, "Sans lien", valeur=3.0)
    _titre(db_session, "Avec lien", valeur=1.0, url="https://exemple.fr/x")
    monkeypatch.setattr(
        service_cours, "lire_cours", lambda url: source_cours.Cours(valeur=9.0)
    )

    reponse = routeur_cours.rafraichir_tout(db_session)

    assert {titre.action_nom for titre in reponse.titres} == {"Sans lien", "Avec lien"}
    assert len(reponse.resultats) == 1


def test_les_sources_annoncees_sont_celles_qui_savent_lire():
    """La liste affichée à l'utilisateur vient du code qui lit les pages : elle
    ne peut pas promettre une source qui n'existe plus."""
    annoncees = {source.id for source in routeur_cours.list_sources()}

    assert annoncees == {source["id"] for source in source_cours.SOURCES}
