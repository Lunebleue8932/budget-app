"""Rafraîchir les cours : quels titres, dans quel ordre, et que faire du résultat.

CE QUI EST ÉCRIT EN BASE, ET CE QUI NE L'EST PAS. Un rafraîchissement ne touche
qu'`action.valeur` et `action.cours_maj_le`. Il ne recalcule AUCUN solde, ne
crée AUCUNE opération et ne modifie AUCUN prix payé : le cours ne sert qu'à
valoriser un portefeuille à l'écran, exactement comme quand il était saisi à la
main (cf. models.Action). Brancher Internet ne change donc rien à la
comptabilité — au pire, un chiffre d'affichage est faux, et le suivant le
corrige.

UN ÉCHEC N'EST JAMAIS FATAL. Dix titres, trois sources, une connexion qui peut
tomber : le cas normal n'est pas « tout marche », c'est « la plupart marchent ».
Chaque titre est donc rapporté séparément, avec son erreur en clair, et les
lectures réussies sont écrites même si les autres ont échoué. L'inverse — tout
annuler parce qu'un site est en panne — priverait l'utilisateur de neuf cours
frais pour un lien cassé.

LES LECTURES PARTENT EN PARALLÈLE, LES ÉCRITURES RESTENT EN SÉRIE. Attendre
douze secondes par titre à la file rendrait le bouton inutilisable dès cinq
titres. Mais une session SQLAlchemy n'est pas faite pour être partagée entre
threads : les threads ne font que du réseau (ils ne reçoivent qu'un couple
(url, monnaie), pas un objet de la base), et c'est le thread principal qui
écrit ensuite ce qu'ils ont rapporté.
"""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app import crud, models

from source_cours import Cours, CoursIllisible, lire_cours

# Quatre lectures de front : assez pour qu'un portefeuille d'une dizaine de
# lignes se rafraîchisse en une poignée de secondes, assez peu pour ne pas
# ressembler à une rafale du point de vue du site interrogé.
LECTURES_SIMULTANEES = 4


# ---------- Devises : refuser un cours libellé dans une autre monnaie ----------
#
# LE PIÈGE QUE CECI ÉVITE. Un titre coté en dollars, un compte en euros : écrire
# le cours tel quel donnerait une valorisation fausse d'un tiers, sans rien
# afficher d'anormal — un nombre plausible est le pire des résultats. On refuse
# donc l'écriture quand la devise lue et la monnaie du titre sont toutes deux
# CONNUES et différentes.
#
# Connues seulement : la table ci-dessous ne prétend pas couvrir toutes les
# monnaies du monde, et la monnaie d'un titre est du texte libre saisi par
# l'utilisateur (« Euro », « € », « EUR »…). Une monnaie qu'on ne sait pas
# rattacher à un code laisse simplement passer — mieux vaut un contrôle qui ne
# se déclenche pas qu'un contrôle qui bloque à tort un titre parfaitement réglé.

_DEVISES = {
    # code ISO : (noms reconnus, symboles reconnus)
    "EUR": (("euro", "euros", "eur"), ("€",)),
    "USD": (("dollar us", "dollar américain", "dollar americain", "usd"), ("$", "us$")),
    "GBP": (("livre sterling", "livre", "gbp"), ("£",)),
    "CHF": (("franc suisse", "chf"), ("chf",)),
    "JPY": (("yen", "jpy"), ("¥",)),
    "CAD": (("dollar canadien", "cad"), ("$", "c$")),
    "AUD": (("dollar australien", "aud"), ("$", "a$")),
    "SEK": (("couronne suédoise", "couronne suedoise", "sek"), ("kr",)),
    "NOK": (("couronne norvégienne", "couronne norvegienne", "nok"), ("kr",)),
    "DKK": (("couronne danoise", "dkk"), ("kr",)),
    "PLN": (("zloty", "złoty", "pln"), ("zł",)),
    "BRL": (("réal", "real", "brl"), ("r$",)),
}


def normaliser_devise(code: Optional[str]) -> Optional[str]:
    """Le code de devise tel qu'il sera comparé, ou None s'il n'y en a pas.

    ATTENTION AUX SOUS-UNITÉS, qui valent un facteur 100. Yahoo publie les
    valeurs de Londres en `GBp` — des PENCE, pas des livres — et la convention
    est la même ailleurs (`ZAc`, `ILa`) : trois lettres dont la dernière est en
    minuscule. Les passer bêtement en majuscules ferait passer 950 pence pour
    950 livres, soit une valorisation cent fois trop grande sur un titre par
    ailleurs correctement réglé.

    On leur laisse donc un code À PART (« GBp »), qui ne correspondra à aucune
    monnaie de la table : le titre sera signalé en écart de devise, avec un
    message qui nomme la sous-unité, plutôt que silencieusement centuplé.
    """
    if not code:
        return None
    code = code.strip()
    if len(code) == 3 and code[:2].isupper() and code[2].islower():
        return code  # sous-unité : jamais confondue avec la monnaie principale
    return code.upper()


def _code_monnaie(monnaie: models.Monnaie) -> Optional[str]:
    """Le code ISO d'une monnaie de l'application, s'il est reconnaissable.

    LE NOM D'ABORD, LE SYMBOLE ENSUITE. « Dollar US » ne désigne qu'une
    monnaie, quand « $ » en désigne trois : chercher dans les deux à la fois
    rendrait ambigu un réglage qui ne l'est pas.

    Rendu None dès que ça reste ambigu — ou inconnu, ce qui est le cas de toute
    monnaie absente de la table ci-dessus. Refuser un cours sur une devinette
    serait pire que ne rien vérifier : c'est un titre correctement réglé qui
    cesserait de se mettre à jour, sans que son propriétaire voie pourquoi."""
    for index, repere in enumerate((monnaie.nom, monnaie.symbole)):
        repere = (repere or "").strip().lower()
        if not repere:
            continue
        trouves = {
            code for code, libelles in _DEVISES.items() if repere in libelles[index]
        }
        if len(trouves) == 1:
            return trouves.pop()
        if trouves:
            return None  # ambigu : le symbole ne tranchera pas mieux que le nom
    return None


# Les sous-unités et ce qu'elles valent. Londres cote en pence (`GBX` chez
# Google, `GBp` chez Yahoo), Johannesburg en cents, Tel-Aviv en agorot : la
# valeur affichée y est CENT FOIS le montant en monnaie principale.
#
# Elles ont leur message à elles parce que le cas n'est ni rare ni évident :
# « le cours lu est en GBX » n'apprend rien à qui vient de coller la page d'une
# action britannique et la voit refusée.
_SOUS_UNITES = {
    "GBX": ("GBP", "pence"),
    "GBp": ("GBP", "pence"),
    "ZAc": ("ZAR", "cents"),
    "ZAX": ("ZAR", "cents"),
    "ILA": ("ILS", "agorot"),
    "ILa": ("ILS", "agorot"),
}


def ecart_de_devise(cours: Cours, monnaie: models.Monnaie) -> Optional[str]:
    """Le message d'erreur si les devises se contredisent, None sinon."""
    lue = normaliser_devise(cours.devise)
    attendue = _code_monnaie(monnaie)
    if lue is None or attendue is None or lue == attendue:
        return None

    sous_unite = _SOUS_UNITES.get(lue)
    if sous_unite is not None and sous_unite[0] == attendue:
        return (
            f"Cette page cote en {sous_unite[1]} ({lue}), pas en {monnaie.nom} : "
            f"le cours y vaut cent fois celui du titre ({cours.valeur:g} "
            f"{sous_unite[1]} = {cours.valeur / 100:g} {monnaie.symbole}). Cours "
            f"non enregistré — choisis une page qui cote en {attendue}."
        )
    return (
        f"Le cours lu est en {lue}, or le titre est coté en {monnaie.nom} "
        f"({attendue}) : cours non enregistré. Choisis une page qui cote dans "
        "la monnaie du titre."
    )


# ---------- Rafraîchissement ----------


@dataclass
class Resultat:
    """Ce qu'un titre a donné. Un par titre suivi, réussite ou échec."""

    action_id: int
    action_nom: str
    ok: bool
    cours: Optional[float] = None
    ancien_cours: Optional[float] = None
    source: Optional[str] = None
    libelle_source: Optional[str] = None
    erreur: Optional[str] = None


@dataclass
class Resume:
    """Le compte rendu d'un rafraîchissement, tel que l'écran l'affiche."""

    resultats: list[Resultat] = field(default_factory=list)
    horodatage: Optional[datetime] = None

    @property
    def reussis(self) -> int:
        return sum(1 for r in self.resultats if r.ok)

    @property
    def echecs(self) -> int:
        return sum(1 for r in self.resultats if not r.ok)


def titres_suivis(db: Session) -> list[models.Action]:
    """Les titres qui portent un lien : les seuls que le web peut rafraîchir.

    Les autres ne sont pas des échecs, ils ne sont simplement pas concernés —
    un cours saisi à la main reste parfaitement légitime, l'extension ne le
    remplace pas, elle s'y ajoute."""
    return [action for action in crud.get_actions(db) if action.url_cours]


def rafraichir(db: Session, actions: list[models.Action]) -> Resume:
    """Relit le cours de ces titres et écrit ceux qui ont pu être lus."""
    if not actions:
        return Resume(resultats=[], horodatage=None)

    # Tout ce dont les threads ont besoin est extrait ICI, dans le thread qui
    # possède la session : ils ne reçoivent que des chaînes et des nombres, et
    # ne peuvent donc pas déclencher un chargement paresseux depuis un autre
    # thread (ce que SQLAlchemy ne garantit pas).
    plan = [(action.id, action.url_cours) for action in actions]

    with ThreadPoolExecutor(max_workers=LECTURES_SIMULTANEES) as executeur:
        lus = list(executeur.map(lambda tache: _lire(*tache), plan))

    # UN SEUL HORODATAGE POUR TOUT LE LOT : dix titres relus d'un même clic
    # portent la même date, ce qui se lit comme l'unique geste que ç'a été.
    # Des dates à la seconde près raconteraient l'ordre d'exécution du code,
    # information dont personne n'a l'usage.
    maintenant = datetime.now()
    resume = Resume(horodatage=maintenant)
    par_id = {action.id: action for action in actions}

    for action_id, cours, erreur in lus:
        action = par_id[action_id]
        if erreur is not None:
            resume.resultats.append(
                Resultat(action.id, action.nom, ok=False, erreur=erreur)
            )
            continue
        conflit = ecart_de_devise(cours, action.monnaie)
        if conflit is not None:
            resume.resultats.append(
                Resultat(action.id, action.nom, ok=False, erreur=conflit)
            )
            continue
        ancien = action.valeur
        crud.enregistrer_cours_en_ligne(db, action, cours.valeur, maintenant)
        resume.resultats.append(
            Resultat(
                action.id,
                action.nom,
                ok=True,
                cours=cours.valeur,
                ancien_cours=ancien,
                source=cours.source,
                libelle_source=cours.libelle,
            )
        )
    return resume


def _lire(action_id: int, url: str):
    """Une lecture, dans un thread. Ne lève jamais : toute erreur revient comme
    un message, sinon un site en panne ferait échouer le lot entier."""
    try:
        return action_id, lire_cours(url), None
    except CoursIllisible as exc:
        return action_id, None, str(exc)
    except Exception as exc:  # noqa: BLE001 — un site hostile ne casse pas l'app
        return action_id, None, f"Lecture impossible ({type(exc).__name__})"
