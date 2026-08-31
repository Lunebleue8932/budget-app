"""Ce que le portefeuille contient, vu par type de titre.

PAR MONNAIE, ET JAMAIS AUTREMENT. C'est la règle centrale de l'application : rien
ne permet d'additionner des euros et des dollars, et un camembert qui les
mélangerait donnerait des parts fausses avec l'air d'être juste. Un portefeuille
à cheval sur deux devises rend donc deux répartitions, que l'écran présente sous
deux onglets — exactement comme le dashboard.

TOUS COMPTES CONFONDUS. C'est la raison d'être de cet écran : la page Placements
répond déjà « qu'y a-t-il sur ce PEA », et n'a aucun moyen de répondre « à quoi
suis-je exposé, en tout ». Le prix de revient, lui, se déroule par portefeuille
(cf. services/placements._replier_mouvements) : les détentions sont donc lues
compte par compte, puis SEULEMENT sommées ici.

SUR LA VALORISATION, pas sur le montant investi. La question posée est « de quoi
mon patrimoine est-il fait aujourd'hui », et deux lignes achetées au même prix
il y a dix ans ne pèsent plus pareil. Le montant investi voyage quand même dans
la réponse : il dit ce que la part a coûté, et l'écart entre les deux est la
plus-value latente.
"""
from app import crud
from app.services import placements

# Ce qu'un titre sans étiquette porte comme identifiant de type. `None` plutôt
# que 0 ou -1 : c'est déjà ce que la colonne vaut en base, et l'écran n'a alors
# rien à traduire.
TYPE_NON_RENSEIGNE = None

# Combien de lignes l'infobulle d'une part énumère. Trois, comme celle de
# l'histogramme des dépenses du dashboard : assez pour dire ce qui pèse, assez
# peu pour se lire d'un coup d'œil sans que la bulle couvre le graphe.
TAILLE_DU_TOP = 3


def exposition_par_type(db) -> list[dict]:
    """La répartition du portefeuille par type de titre, une entrée par monnaie.

    Chaque entrée porte ses parts triées de la plus lourde à la plus légère, et
    chaque part le détail des titres qui la composent — c'est ce détail que
    l'infobulle du camembert lit, et il vaut mieux le calculer ici, où les
    quantités sont déjà repliées, que de le refaire à l'écran.

    Un compte dont tout est soldé ne rend aucune ligne, et une monnaie sans
    aucune détention n'apparaît pas : un onglet vide n'a rien à montrer.
    """
    # (monnaie_id, type_titre_id) -> agrégat. Deux clés parce que la monnaie
    # cloisonne (on n'additionne pas deux devises) et que le type regroupe.
    cases: dict = {}
    monnaies: dict = {}

    for compte in placements.get_comptes_placement(db):
        for ligne in placements.detentions(db, compte.id):
            action = crud.get_action(db, ligne["action_id"])
            type_id = action.type_titre_id if action else TYPE_NON_RENSEIGNE
            type_nom = action.type_titre.nom if action and action.type_titre else None

            monnaies.setdefault(
                ligne["monnaie_id"],
                {"monnaie_id": ligne["monnaie_id"], "monnaie_symbole": ligne["monnaie_symbole"]},
            )
            case = cases.setdefault(
                (ligne["monnaie_id"], type_id),
                {
                    "type_titre_id": type_id,
                    "type_titre_nom": type_nom,
                    "valorisation": 0.0,
                    "montant_investi": 0.0,
                    "titres": {},
                },
            )
            case["valorisation"] += ligne["valorisation"]
            case["montant_investi"] += ligne["montant_investi"]

            # UN MÊME TITRE PEUT ÊTRE DÉTENU SUR PLUSIEURS COMPTES (c'est même
            # le cas ordinaire d'un ETF large). Il ne doit apparaître qu'une
            # fois dans le détail d'une part, avec la somme de ses lignes — deux
            # entrées du même nom se liraient comme une erreur.
            titre = case["titres"].setdefault(
                ligne["action_id"],
                {
                    "action_id": ligne["action_id"],
                    "action_nom": ligne["action_nom"],
                    "valorisation": 0.0,
                    "nombre_comptes": 0,
                },
            )
            titre["valorisation"] += ligne["valorisation"]
            titre["nombre_comptes"] += 1

    resultat = []
    for monnaie_id, monnaie in monnaies.items():
        parts = [
            case for (m_id, _), case in cases.items() if m_id == monnaie_id
        ]
        total = sum(part["valorisation"] for part in parts)
        for part in parts:
            titres = sorted(
                part.pop("titres").values(),
                key=lambda t: t["valorisation"],
                reverse=True,
            )
            # LA PART EST CALCULÉE ICI, pas à l'écran : c'est le même chiffre
            # qui sert à dessiner l'angle et à écrire le pourcentage, et deux
            # calculs séparés finiraient par ne plus tomber d'accord à l'arrondi.
            part["part"] = part["valorisation"] / total if total else 0.0
            part["nombre_titres"] = len(titres)
            part["titres"] = titres[:TAILLE_DU_TOP]
        parts.sort(key=lambda part: part["valorisation"], reverse=True)
        resultat.append(
            {
                **monnaie,
                "total": total,
                "total_investi": sum(part["montant_investi"] for part in parts),
                "parts": parts,
            }
        )

    # Les monnaies dans l'ordre où l'application les range partout ailleurs
    # (dashboard, menus) : l'onglet actif doit rester au même endroit d'un écran
    # à l'autre.
    ordre = {m.id: m.ordre for m in crud.get_monnaies(db)}
    resultat.sort(key=lambda bloc: ordre.get(bloc["monnaie_id"], 0))
    return resultat
