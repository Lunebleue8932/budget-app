"""« Tout » : toute l'histoire du budget, lue d'un seul tenant.

LA VUE « TOUT » DU DASHBOARD EST LA SOMME DES VUES ANNUELLES — pas un calcul à
part. Chaque agrégat de période du noyau (`soldes.get_flux_periode`,
`get_depenses_par_categorie`…) prend une année et éventuellement un mois, et leur
logique — amortissement étalé, reste à charge d'une dépense remboursable, parts
des découpes, héritage du budget — y est écrite UNE fois. Les réécrire pour une
fenêtre libre aurait fait deux versions de chacune, qui finissent par ne plus
tomber d'accord. Une fenêtre « tout » appelle donc la vue annuelle de chaque
année couverte et FOND les résultats : les sommes s'additionnent, et c'est
exactement ce que fait déjà `service_objectifs._depenses_budget` pour la fenêtre
« tout » d'un objectif.

`ToutesLesAnnees` PORTE LES MÊMES NOMS que `services.soldes` pour ces cinq
agrégats : le routeur du dashboard n'a qu'à choisir lequel appeler, et le reste
de son code ne distingue pas les deux.

DEUX CHOIX À CONNAÎTRE
  - LES ANNÉES COUVERTES vont de la première opération connue à la dernière,
    prévisionnelles comprises (les récurrences sont générées jusqu'à vingt-quatre
    mois d'avance) : c'est ce que couvrirait la vue annuelle de chacune de ces
    années, et la vue « tout » ne peut pas être plus courte que la somme des
    années qu'elle affiche.
  - LE DÉTAIL PAR LIBELLÉ (les trois plus grosses lignes d'une barre ou d'une
    carte) est FONDU puis reclassé à partir des trois premières de chaque année.
    Un libellé quatrième de chaque année, mais premier sur l'ensemble, n'y
    figurerait pas : c'est une approximation du classement, jamais du total, qui
    reste exact. Le montant de chaque ligne montrée est, lui, celui de son
    classement par année.
"""
from datetime import date as date_type
from typing import Optional

from sqlalchemy.orm import Session

from . import soldes


def annees_couvertes(db: Session, aujourdhui: Optional[date_type] = None) -> list[int]:
    """Les années que « tout » recouvre — la fonction vit dans `soldes`, qui en
    a aussi besoin pour la moyenne hebdomadaire (cf. `soldes.annees_couvertes`)."""
    return soldes.annees_couvertes(db, aujourdhui)


def premier_jour(db: Session, aujourdhui: Optional[date_type] = None) -> date_type:
    """Le 1er janvier de la première année couverte — où commence « tout »."""
    return date_type(annees_couvertes(db, aujourdhui)[0], 1, 1)


def fin_de_periode_tout(db: Session, aujourdhui: Optional[date_type] = None) -> date_type:
    """Le dernier jour de la dernière année couverte : la borne de la projection
    des soldes, comme la fin de l'année l'est pour la vue annuelle."""
    return date_type(annees_couvertes(db, aujourdhui)[-1], 12, 31)


def _fondre_tops(listes: list[list[dict]]) -> list[dict]:
    """Fond des « plus grosses lignes » par libellé puis reclasse — la même règle
    que `soldes` (cf. DepenseTopRead : trois « Courses » à 25 € sont une ligne de
    75 €), et le même tri, pour que l'ordre ne dépende pas du hasard."""
    cumul: dict[str, dict] = {}
    for liste in listes:
        for ligne in liste:
            existante = cumul.setdefault(
                ligne["nature"], {"nature": ligne["nature"], "montant": 0.0, "nombre": 0}
            )
            existante["montant"] += ligne["montant"]
            existante["nombre"] += ligne.get("nombre", 1)
    return sorted(cumul.values(), key=lambda d: (-d["montant"], d["nature"]))[
        : soldes.NB_TOP_DEPENSES
    ]


class ToutesLesAnnees:
    """Les cinq agrégats de période du dashboard, sur toutes les années.

    Les paramètres `annee` et `mois` sont acceptés pour avoir la même signature
    que `services.soldes` et IGNORÉS : c'est la liste d'années donnée au
    constructeur qui fait foi."""

    def __init__(self, annees: list[int]):
        self.annees = annees

    def get_flux_periode(self, db, annee, mois, monnaie_id) -> dict:
        entrees = sorties = 0.0
        for a in self.annees:
            flux = soldes.get_flux_periode(db, a, None, monnaie_id)
            entrees += flux["entrees"]
            sorties += flux["sorties"]
        return {"entrees": entrees, "sorties": sorties, "variation": entrees - sorties}

    def get_top_flux_periode(self, db, annee, mois, monnaie_id) -> dict:
        tops = [soldes.get_top_flux_periode(db, a, None, monnaie_id) for a in self.annees]
        return {
            "entrees": _fondre_tops([t["entrees"] for t in tops]),
            "sorties": _fondre_tops([t["sorties"] for t in tops]),
        }

    def get_variation_brute(self, db, annee, mois, monnaie_id) -> float:
        return sum(soldes.get_variation_brute(db, a, None, monnaie_id) for a in self.annees)

    def get_budget_total_periode(self, db, annee, mois, monnaie_id) -> float:
        return sum(
            soldes.get_budget_total_periode(db, a, None, monnaie_id) for a in self.annees
        )

    def get_depenses_par_categorie(self, db, annee, mois, monnaie_id) -> list[dict]:
        """Une ligne par catégorie, sommée sur les années — dans l'ordre où la
        première année qui la porte la range, comme la vue annuelle."""
        fondues: dict[str, dict] = {}
        for a in self.annees:
            for ligne in soldes.get_depenses_par_categorie(db, a, None, monnaie_id):
                cumul = fondues.setdefault(
                    ligne["categorie"],
                    {
                        **ligne,
                        "total_reel": 0.0,
                        "total_previsionnel": 0.0,
                        "budget_alloue": 0.0,
                        "top_depenses": [],
                    },
                )
                cumul["total_reel"] += ligne["total_reel"]
                cumul["total_previsionnel"] += ligne["total_previsionnel"]
                cumul["budget_alloue"] += ligne["budget_alloue"]
                cumul["top_depenses"] = _fondre_tops([cumul["top_depenses"], ligne["top_depenses"]])
        return list(fondues.values())

def ecart_variations_tout(db: Session, annees: list[int], monnaie_id: int) -> dict:
    """Le détail de l'écart entre les deux variations, sur toutes les années.

    LES TROIS TOTAUX S'ADDITIONNENT et les lignes se mettent bout à bout, puis se
    reclassent par écart décroissant comme le fait `soldes.get_ecart_variations` :
    l'invariant (la somme des écarts des lignes vaut l'écart) tient donc sur
    « tout » exactement comme sur chaque année."""
    total = {"variation_brute": 0.0, "variation_attribuee": 0.0, "ecart": 0.0, "lignes": []}
    for a in annees:
        detail = soldes.get_ecart_variations(db, a, None, monnaie_id)
        total["variation_brute"] += detail["variation_brute"]
        total["variation_attribuee"] += detail["variation_attribuee"]
        total["ecart"] += detail["ecart"]
        total["lignes"] += detail["lignes"]
    total["lignes"].sort(key=lambda ligne: abs(ligne["ecart"]), reverse=True)
    return total
