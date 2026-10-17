"""Proposer la catégorie de l'app qui correspond à une catégorie du relevé.

LE PROBLÈME. Chaque banque nomme ses catégories à sa façon (« Alimentation et restauration »,
« Supermarchés / Bouche », « Food & Dining »), et l'import demandait de les rapprocher à la main,
banque par banque. Ce module propose, l'utilisateur CONFIRME — il n'applique jamais rien tout seul.

CINQ PALIERS, dans cet ordre, et c'est l'ordre qui compte :

  1. LA TABLE SAUVEGARDÉE (`ImportCategorieMapping`, par preset) : si le couple existe, il s'applique,
     sans rien demander. C'est le cas de 100 % des imports suivants. Ce palier n'est PAS ici :
     il vit dans `import_bancaire` (`crud.get_mapping_categorie`) et passe avant tout ce qui suit.
  2. LA NORMALISATION (`normaliser`) : minuscules, sans accents ni ponctuation, espaces
     écrasés. « Alimentation & Restauration » et « alimentation restauration » sont le même mot.
  3. LES ALIAS : chaque catégorie de l'app porte une liste de mots-clés (`Categorie.mots_cles_perso`,
     migration 0085), en français, en anglais et en portugais du Brésil. Tant que l'utilisateur
     n'a pas écrit la sienne, ce sont les listes livrées ci-dessous.
  4. LE FLOU (`_score`) : le libellé normalisé est comparé au nom et à chaque alias, par
     inclusion de mots entiers, préfixe, puis ressemblance de chaînes (difflib, de la
     bibliothèque standard — aucune dépendance de plus à embarquer dans le bundle). Deux seuils :
     au-dessus de `SEUIL_HAUT`, une proposition PRÉSÉLECTIONNÉE ; entre `SEUIL_BAS` et
     `SEUIL_HAUT`, les trois meilleures SUGGÉRÉES ; en dessous, « à classer ».
  5. LA VALIDATION : toute proposition est confirmée une fois par l'utilisateur, puis écrite dans
     la table du palier 1. JAMAIS d'application silencieuse, même au-dessus du seuil haut — c'est
     l'écran qui l'impose (le bouton « Confirmer »), pas ce module, qui ne fait que lire.

CE MODULE NE FAIT QUE LIRE : aucune écriture en base, aucune catégorie créée ni modifiée.
"""
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Optional

from sqlalchemy.orm import Session

from app import models

# Au-dessus : proposition présélectionnée. Entre les deux : trois suggestions. En dessous :
# « à classer ». Deux seuils, parce qu'« assez proche pour cocher d'avance » et « assez proche
# pour être proposé » ne sont pas la même question.
SEUIL_HAUT = 0.88
SEUIL_BAS = 0.62
# Deux catégories au-dessus du seuil haut à moins de cet écart : la banque est ambiguë, on ne
# présélectionne rien.
ECART_AMBIGU = 0.03
NB_SUGGESTIONS = 3
# Un mot plus court que ça ne vaut jamais une inclusion : « cb », « tv », « de » trouvent trop
# de choses.
LONGUEUR_MIN_MOT = 3


def normaliser(texte: Optional[str]) -> str:
    """Minuscules, sans accents, sans ponctuation, espaces écrasés."""
    if not texte:
        return ""
    decompose = unicodedata.normalize("NFKD", str(texte))
    sans_accents = "".join(c for c in decompose if not unicodedata.combining(c))
    minuscules = sans_accents.lower().replace("œ", "oe").replace("æ", "ae")
    return re.sub(r"[^a-z0-9]+", " ", minuscules).strip()


# ---------- Les mots-clés livrés ----------
#
# Une quarantaine par catégorie, français / anglais / portugais du Brésil mêlés : un relevé
# n'annonce pas sa langue. Ils ne servent que tant que la catégorie n'a pas SA liste : dès qu'on
# en écrit une (`Categorie.mots_cles_perso`), elle remplace celle-ci en entier — jamais de fusion, ce
# qu'on retire d'une liste doit rester retiré.

_ALIMENTAIRE = [
    "courses", "supermarché", "supermarche", "hypermarché", "alimentation", "alimentaire",
    "nourriture", "épicerie", "epicerie", "boulangerie", "boucherie", "poissonnerie", "primeur",
    "fruits et légumes", "marché", "restaurant", "restauration", "fast food", "mcdo", "mcdonald",
    "burger", "pizza", "kebab", "sandwich", "traiteur", "café", "boissons", "cantine",
    "livraison repas", "carrefour", "leclerc", "auchan", "lidl", "intermarché", "monoprix",
    "groceries", "grocery", "food", "dining", "takeaway", "bakery", "butcher", "coffee",
    "mercado", "supermercado", "padaria", "açougue", "acougue", "hortifruti", "lanchonete",
    "alimentação", "alimentacao", "comida", "refeição", "refeicao",
]

_LOISIRS = [
    "loisirs", "sorties", "sortie", "cinéma", "cinema", "théâtre", "theatre", "concert",
    "spectacle", "musée", "musee", "bar", "boîte de nuit", "soirée", "soiree", "jeux vidéo",
    "jeux video", "jeu", "streaming", "netflix", "spotify", "disney", "abonnement culturel",
    "sport", "salle de sport", "gym", "vacances", "voyage", "hôtel", "hotel", "week end",
    "parc d'attractions", "loisir", "livre", "librairie", "hobby", "culture", "divertissement",
    "entertainment", "leisure", "movies", "games", "nightlife", "travel", "holiday",
    "lazer", "diversão", "diversao", "viagem", "passeio", "festa", "balada", "academia",
]

_TRANSPORTS = [
    "transports", "transport", "carburant", "essence", "gazole", "diesel", "station service",
    "péage", "peage", "parking", "stationnement", "autoroute", "train", "sncf", "ter", "tgv",
    "métro", "metro", "bus", "tramway", "navigo", "ratp", "taxi", "uber", "vtc", "bolt",
    "covoiturage", "blablacar", "vélo", "velo", "trottinette", "avion", "billet d'avion",
    "assurance auto", "entretien véhicule", "garage", "fuel", "gas", "toll", "transit",
    "ride", "flight", "gasolina", "combustível", "combustivel", "pedágio", "pedagio",
    "estacionamento", "ônibus", "onibus", "passagem",
]

_CHARGES_FIXES = [
    "charges fixes", "loyer", "logement", "habitation", "électricité", "electricite", "edf",
    "engie", "gaz", "eau", "internet", "box", "fibre", "téléphone", "telephone", "mobile",
    "forfait", "assurance", "mutuelle", "impôts", "impots", "taxe", "taxe foncière",
    "taxe d'habitation", "crédit", "credit", "prêt immobilier", "pret immobilier",
    "remboursement de prêt", "abonnement", "cotisation", "charges", "copropriété",
    "copropriete", "syndic", "rent", "mortgage", "utilities", "electricity", "water",
    "insurance", "bills", "subscription", "aluguel", "condomínio", "condominio", "luz",
    "água", "agua", "seguro", "conta de luz", "financiamento",
]

_ENTREES = [
    "entrées d'argent", "entrees d'argent", "salaire", "paie", "paye", "virement salaire",
    "revenu", "revenus", "rémunération", "remuneration", "prime", "bonus", "allocation",
    "caf", "pôle emploi", "pole emploi", "chômage", "chomage", "retraite", "pension",
    "dividendes", "intérêts", "interets", "remboursement", "loyer perçu", "freelance",
    "honoraires", "vente", "cadeau reçu", "income", "salary", "wages", "payroll", "refund",
    "dividend", "interest", "salário", "salario", "renda", "rendimento", "décimo terceiro",
    "13o salario", "reembolso", "proventos",
]

_SANTE = [
    "santé", "sante", "médecin", "medecin", "docteur", "dentiste", "pharmacie", "médicament",
    "medicament", "ordonnance", "hôpital", "hopital", "clinique", "kiné", "kine", "osteo",
    "ostéopathe", "ophtalmo", "opticien", "lunettes", "analyses", "laboratoire", "mutuelle santé",
    "soins", "psychologue", "health", "medical", "doctor", "dentist", "pharmacy", "hospital",
    "saúde", "saude", "médico", "medico", "farmácia", "farmacia", "consulta", "plano de saúde",
]

_VETEMENTS = [
    "vêtements", "vetements", "habillement", "mode", "chaussures", "zara", "h&m", "kiabi",
    "decathlon", "décathlon", "équipement", "equipement", "accessoires", "entretien", "pressing",
    "couture", "réparation", "reparation", "bricolage", "castorama", "leroy merlin", "ikea",
    "meubles", "électroménager", "electromenager", "clothing", "clothes", "shoes", "fashion",
    "apparel", "roupas", "calçados", "calcados", "vestuário", "vestuario", "moda", "reforma",
]

# Par NOM de catégorie normalisé (et ses synonymes) : la clé reconnaît « Loisirs & sorties »
# comme « Loisirs ». Une catégorie sans entrée ici n'a que son propre nom.
_PAR_NOM = {
    "alimentaire": _ALIMENTAIRE, "alimentation": _ALIMENTAIRE, "courses": _ALIMENTAIRE,
    "food": _ALIMENTAIRE, "groceries": _ALIMENTAIRE, "alimentacao": _ALIMENTAIRE,
    "loisirs": _LOISIRS, "loisirs sorties": _LOISIRS, "sorties": _LOISIRS,
    "entertainment": _LOISIRS, "leisure": _LOISIRS, "lazer": _LOISIRS,
    "transports": _TRANSPORTS, "transport": _TRANSPORTS, "deplacements": _TRANSPORTS,
    "transportation": _TRANSPORTS, "transportes": _TRANSPORTS,
    "charges fixes": _CHARGES_FIXES, "charges": _CHARGES_FIXES, "logement": _CHARGES_FIXES,
    "fixed costs": _CHARGES_FIXES, "bills": _CHARGES_FIXES, "contas fixas": _CHARGES_FIXES,
    "entrees d argent": _ENTREES, "revenus": _ENTREES, "income": _ENTREES,
    "salaire": _ENTREES, "receitas": _ENTREES,
    "depenses medicales": _SANTE, "sante": _SANTE, "health": _SANTE, "saude": _SANTE,
    "vetements equipements entretien": _VETEMENTS, "vetements": _VETEMENTS,
    "vetements equipement sport": _VETEMENTS, "clothing": _VETEMENTS, "roupas": _VETEMENTS,
}

# « Autres » n'attire rien par mots-clés : c'est le repli, pas une destination qu'un libellé
# désigne. Seuls ces mots y mènent.
_AUTRES = {"autres", "divers", "other", "others", "misc", "miscellaneous", "outros", "diversos"}


def mots_cles_par_defaut(nom_categorie: str) -> list[str]:
    """Les mots-clés livrés pour une catégorie, d'après son nom ; vide si on n'en connaît pas."""
    return list(_PAR_NOM.get(normaliser(nom_categorie), []))


def mots_cles_de(categorie: models.Categorie) -> list[str]:
    """Les mots-clés EN VIGUEUR : ceux de l'utilisateur dès qu'il en a écrit (même une liste
    vide — c'est un choix), sinon les livrés."""
    if categorie.mots_cles_perso is not None:
        return [str(m) for m in categorie.mots_cles_perso]
    return mots_cles_par_defaut(categorie.nom)


# ---------- La ressemblance ----------


def _score(libelle: str, candidat: str) -> float:
    """Entre 0 et 1 : à quel point `libelle` (déjà normalisé) désigne `candidat` (idem).

    DANS L'ORDRE : égalité (1), tous les mots du candidat présents dans le libellé (0,95 — c'est
    « supermarche » dans « supermarches bouche »), l'inverse (0,9), un mot qui en commence un
    autre (0,9, « restau » → « restaurant »), puis la ressemblance de chaînes, au mot près
    et en bloc."""
    if not libelle or not candidat:
        return 0.0
    if libelle == candidat:
        return 1.0
    mots_l = [m for m in libelle.split() if len(m) >= LONGUEUR_MIN_MOT]
    mots_c = [m for m in candidat.split() if len(m) >= LONGUEUR_MIN_MOT]
    if not mots_l or not mots_c:
        return 0.0
    ens_l, ens_c = set(libelle.split()), set(candidat.split())
    if ens_c <= ens_l and any(len(m) >= LONGUEUR_MIN_MOT for m in ens_c):
        return 0.95
    if ens_l <= ens_c:
        return 0.9
    meilleur = 0.0
    for ml in mots_l:
        for mc in mots_c:
            if min(len(ml), len(mc)) >= 5 and (ml.startswith(mc) or mc.startswith(ml)):
                meilleur = max(meilleur, 0.9)
            else:
                meilleur = max(meilleur, SequenceMatcher(None, ml, mc).ratio())
    # Le bloc entier, pour les libellés sans mot « plein » (« h m », « 13o »).
    meilleur = max(meilleur, SequenceMatcher(None, libelle, candidat).ratio())
    return meilleur


def _candidats(categorie: models.Categorie) -> list[tuple[str, str]]:
    """(texte normalisé, texte d'origine) : le nom, puis chaque alias."""
    vus = set()
    sortie = []
    for brut in [categorie.nom, *mots_cles_de(categorie)]:
        normalise = normaliser(brut)
        if normalise and normalise not in vus:
            vus.add(normalise)
            sortie.append((normalise, brut))
    return sortie


def classer(db: Session, libelle_banque: str) -> list[dict]:
    """Les catégories de l'app, de la plus proche à la moins proche du libellé de la banque :
    [{categorie_id, nom, score, via}], score > 0 seulement. `via` est le mot (nom ou alias) qui a
    porté le score — c'est ce qui permet à l'écran de dire POURQUOI on propose."""
    libelle = normaliser(libelle_banque)
    if not libelle:
        return []
    categories = db.query(models.Categorie).filter(models.Categorie.active.is_(True)).all()
    resultats = []
    for categorie in categories:
        if normaliser(categorie.nom) in _AUTRES:
            # « Autres » ne répond qu'à ses propres mots.
            candidats = [(normaliser(m), m) for m in [categorie.nom, *sorted(_AUTRES)]]
        else:
            candidats = _candidats(categorie)
        meilleur, via = 0.0, None
        for normalise, brut in candidats:
            score = _score(libelle, normalise)
            if score > meilleur:
                meilleur, via = score, brut
        if meilleur > 0:
            resultats.append(
                {
                    "categorie_id": categorie.id,
                    "nom": categorie.nom,
                    "score": round(meilleur, 4),
                    "via": via,
                }
            )
    resultats.sort(key=lambda r: (-r["score"], r["nom"]))
    return resultats


def proposer(db: Session, libelle_banque: str) -> dict:
    """La décision pour UN libellé du relevé :

      {statut: "forte" | "suggestions" | "a_classer", propositions: [≤ 3 × classer()]}

    « forte » : une catégorie au-dessus du seuil haut, sans rivale à moins de `ECART_AMBIGU` —
    l'écran la présélectionne (et demande quand même de confirmer). « suggestions » : les trois
    meilleures entre les deux seuils, ou plusieurs au-dessus du seuil haut qui se disputent.
    « a_classer » : rien d'assez proche."""
    classement = classer(db, libelle_banque)
    if not classement or classement[0]["score"] < SEUIL_BAS:
        return {"statut": "a_classer", "propositions": []}
    tete = classement[0]
    if tete["score"] >= SEUIL_HAUT:
        rivale = len(classement) > 1 and classement[1]["score"] >= SEUIL_HAUT and (
            tete["score"] - classement[1]["score"] < ECART_AMBIGU
        )
        if not rivale:
            retenues = [r for r in classement if r["score"] >= SEUIL_BAS][:NB_SUGGESTIONS]
            return {"statut": "forte", "propositions": retenues}
    retenues = [r for r in classement if r["score"] >= SEUIL_BAS][:NB_SUGGESTIONS]
    return {"statut": "suggestions", "propositions": retenues}
