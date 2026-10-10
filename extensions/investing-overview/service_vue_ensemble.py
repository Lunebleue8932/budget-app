"""Ce que le portefeuille contient, vu sur DEUX AXES.

DEUX QUESTIONS, ET ELLES NE SE RÉPONDENT PAS L'UNE L'AUTRE (migration 0066) :

  - COMMENT C'EST DÉTENU — l'ENVELOPPE : du stock-picking, des ETF, des SCPI.
    C'est ce que cet écran montrait depuis l'origine.
  - À QUOI C'EST EXPOSÉ — la CLASSE D'ACTIF : actions, obligations, immobilier.

Un ETF obligataire est les deux à la fois : « ETF 60 % / Actions 40 % » est un
graphe de CONTENANTS, qui ne dit rien de l'exposition réelle. Tant qu'une seule
colonne portait la question, il fallait choisir laquelle des deux on voulait
lire — et la réponse était fausse une fois sur deux.

LE CALCUL EST LE MÊME POUR LES DEUX, à la colonne près : une seule fonction
paramétrée par l'axe, et non deux qui se ressembleraient jusqu'au jour où l'une
serait corrigée sans l'autre.

PAR MONNAIE, ET JAMAIS AUTREMENT. C'est la règle centrale de l'application : rien
ne permet d'additionner des euros et des dollars, et un camembert qui les
mélangerait donnerait des parts fausses avec l'air d'être juste. Un portefeuille
à cheval sur deux devises rend donc deux répartitions, que l'écran présente sous
deux onglets — exactement comme le dashboard.

TOUS COMPTES CONFONDUS. C'est la raison d'être de cet écran : l'onglet Placements
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
from app.constants import AxeTitre
from app.services import exposition, placements

# Ce qu'un titre sans étiquette porte comme identifiant de type. `None` plutôt
# que 0 ou -1 : c'est déjà ce que la colonne vaut en base, et l'écran n'a alors
# rien à traduire.
TYPE_NON_RENSEIGNE = None

# Combien de lignes l'infobulle d'une part énumère. Trois, comme celle de
# l'histogramme des dépenses du dashboard : assez pour dire ce qui pèse, assez
# peu pour se lire d'un coup d'œil sans que la bulle couvre le graphe.
TAILLE_DU_TOP = 3


def _parts_eclatees(un_titre, axe: str, par_isin: dict) -> list[tuple[object, float]]:
    """L'ETF ÉCLATÉ PAR SA COMPOSITION (migration 0076), quand il n'a pas de répartition à lui
    sur cet axe : chaque ISIN du dictionnaire apporte sa propre répartition, au prorata de son
    poids dans l'ETF. Un composant inconnu de la base, ou sans répartition, n'apporte rien ;
    ce qui manque reste « non renseigné » (cf. `_parts_du_titre`). Un seul niveau : un ETF
    cité dans la composition d'un autre ne s'éclate pas à son tour."""
    cumul: dict = {}
    for isin, poids in (un_titre.composition or {}).items():
        composant = par_isin.get(exposition.normaliser_isin(isin))
        if composant is None or composant.id == un_titre.id:
            continue
        for e in composant.repartition(axe):
            etiquette, part = cumul.get(e.type_titre_id, (e.etiquette, 0.0))
            cumul[e.type_titre_id] = (etiquette, part + (poids / 100.0) * (e.poids_pct / 100.0))
    return list(cumul.values())


def _parts_du_titre(un_titre, axe: str, par_isin: dict | None = None) -> list[tuple[object, float]]:
    """Les `(étiquette, part)` d'un titre sur un axe, la part étant une fraction de 1.

    L'enveloppe : une étiquette, 100 %. Les axes d'exposition : une ligne par
    étiquette de la répartition, plus le RÉSIDU (étiquette `None`) quand elle ne
    couvre pas tout. Un titre sans aucune répartition est entièrement « non
    renseigné » — exactement ce qu'était, avant la 0076, un titre sans classe —
    sauf un ETF qui porte une composition : il s'éclate alors sur ses composants
    (`_parts_eclatees`). Ce qui est renseigné sur le titre lui-même passe toujours
    avant : c'est la donnée la plus directe."""
    if un_titre is None:
        return [(None, 1.0)]
    if axe == AxeTitre.enveloppe.value:
        return [(un_titre.type_titre, 1.0)]
    parts = [(e.etiquette, e.poids_pct / 100.0) for e in un_titre.repartition(axe)]
    if not parts and un_titre.composition and par_isin:
        parts = _parts_eclatees(un_titre, axe, par_isin)
    residu = 1.0 - sum(part for _, part in parts)
    if residu > 1e-9:
        parts.append((None, residu))
    return parts


def exposition_par_axe(db, axe: str = AxeTitre.enveloppe.value) -> list[dict]:
    """La répartition du portefeuille sur un axe, une entrée par monnaie.

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
    # Les composants d'un ETF se retrouvent par leur ISIN, archivés compris : ce sont
    # justement des titres qu'on suit sans les détenir (cf. `_parts_eclatees`).
    par_isin = {
        exposition.normaliser_isin(t.code_isin): t
        for t in crud.get_titres(db, inclure_archivees=True)
        if t.code_isin
    }

    for compte in placements.get_comptes_placement(db):
        for ligne in placements.detentions(db, compte.id):
            un_titre = crud.get_titre(db, ligne["titre_id"])
            # LE SEUL ENDROIT OÙ LES AXES DIFFÈRENT : les parts d'un titre (`_parts_du_titre`).
            # Tout le reste — le repli par monnaie, la somme des détentions, le top des
            # titres, la part — est identique, et c'est pour ça qu'il n'est pas écrit
            # plusieurs fois.
            # UN TITRE PEUT TOUCHER PLUSIEURS PARTS D'UN MÊME AXE (migration 0076) : sur
            # les axes d'exposition il porte une RÉPARTITION, et sa valorisation se
            # distribue au prorata de ses poids — un ETF World à 1 000 € pèse 650 € sur
            # « États-Unis » et 150 € sur « Europe ». Le résidu (100 % moins ce qu'on
            # connaît) tombe dans la part « non renseigné » : RIEN N'EST RENORMALISÉ, et
            # la lire pour complète serait lire une répartition de 30 % du titre comme
            # si c'était tout. Seule l'enveloppe est une étiquette unique, donc une part
            # de 100 %.
            monnaies.setdefault(
                ligne["monnaie_id"],
                {"monnaie_id": ligne["monnaie_id"], "monnaie_symbole": ligne["monnaie_symbole"]},
            )
            for etiquette, part in _parts_du_titre(un_titre, axe, par_isin):
                type_id = etiquette.id if etiquette else TYPE_NON_RENSEIGNE
                type_nom = etiquette.nom if etiquette else None
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
                case["valorisation"] += ligne["valorisation"] * part
                case["montant_investi"] += ligne["montant_investi"] * part

                # UN MÊME TITRE PEUT ÊTRE DÉTENU SUR PLUSIEURS COMPTES (c'est même
                # le cas ordinaire d'un ETF large). Il ne doit apparaître qu'une
                # fois dans le détail d'une part, avec la somme de ses lignes — deux
                # entrées du même nom se liraient comme une erreur.
                titre = case["titres"].setdefault(
                    ligne["titre_id"],
                    {
                        "titre_id": ligne["titre_id"],
                        "titre_nom": ligne["titre_nom"],
                        "valorisation": 0.0,
                        "nombre_comptes": 0,
                    },
                )
                titre["valorisation"] += ligne["valorisation"] * part
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
