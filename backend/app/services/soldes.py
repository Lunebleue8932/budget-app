"""Soldes et agrégats, calculés séparément POUR CHAQUE MONNAIE.

L'app ne stocke aucun taux de change : additionner des euros et des dollars
n'aurait donc aucun sens, et inventer une conversion en aurait encore moins.
Tout ce qui somme des montants ici est donc groupé par monnaie — un compte à
deux monnaies a deux soldes, le dashboard a un jeu de KPI par monnaie, et une
catégorie a un budget par monnaie.

La clé de groupement est partout le couple (compte, monnaie) : c'est ce qui
permet à un compte multi-devises de rester UNE ligne en base (cf.
models.CompteMonnaie) au lieu d'être dupliqué.
"""
import calendar
from datetime import date as date_type
from typing import Optional

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from .. import crud, models
from ..constants import (
    TYPES_COMPTE_HORS_COURANT,
    TYPES_REMBOURSABLES,
    Sens,
    Statut,
    TypeOperation,
)


# Codes des types dont l'opération est remboursable, pour les filtres SQL.
_CODES_REMBOURSABLES = [t.value for t in TYPES_REMBOURSABLES]


def _sums_by_compte_monnaie_and_sens(
    db: Session, statut: Optional[Statut], date_fin: Optional[date_type] = None
):
    query = db.query(
        models.Operation.compte_id,
        models.Operation.monnaie_id,
        models.Operation.sens,
        func.sum(models.Operation.montant).label("total"),
    )
    if statut is not None:
        query = query.filter(models.Operation.statut == statut)
    if date_fin is not None:
        query = query.filter(models.Operation.date <= date_fin)
    query = query.group_by(
        models.Operation.compte_id, models.Operation.monnaie_id, models.Operation.sens
    )

    result: dict = {}
    for compte_id, monnaie_id, sens, total in query.all():
        result.setdefault((compte_id, monnaie_id), {})[sens] = total or 0.0
    return result


def _solde_delta(sums: dict) -> float:
    return (
        sums.get(Sens.entree, 0.0)
        + sums.get(Sens.transfert_entrant, 0.0)
        - sums.get(Sens.depense, 0.0)
        - sums.get(Sens.transfert_sortant, 0.0)
    )


def fin_de_periode(annee: int, mois: Optional[int]) -> date_type:
    """Dernier jour de la période affichée : fin du mois, ou fin de l'année en
    vue annuelle. Sert de borne à la projection des soldes."""
    if mois is None:
        return date_type(annee, 12, 31)
    return date_type(annee, mois, calendar.monthrange(annee, mois)[1])


def _reste_du_prets_par_compte_monnaie(
    db: Session, date_fin: Optional[date_type] = None
) -> dict:
    """Reste à rembourser sur les prêts reçus, par couple (compte, monnaie).

    Un prêt reçu est une entrée d'argent : l'argent est bien là, mais il devra
    être rendu. Il gonfle donc légitimement le solde réel, jamais le solde
    projeté, qui doit refléter ce qu'il restera une fois les engagements soldés.

    C'est `montant_a_rembourser` (le reste dû, qui décroît au fil des
    remboursements) et non `montant` qui est soustrait : sinon rembourser
    pénaliserait deux fois (le prêt jamais compté, et la sortie de trésorerie
    du remboursement en plus)."""
    query = (
        db.query(
            models.Operation.compte_id,
            models.Operation.monnaie_id,
            func.sum(models.Operation.montant_a_rembourser).label("total"),
        )
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(models.TypeOperationDB.code == TypeOperation.pret.value)
    )
    if date_fin is not None:
        query = query.filter(models.Operation.date <= date_fin)
    rows = query.group_by(models.Operation.compte_id, models.Operation.monnaie_id).all()
    return {(compte_id, monnaie_id): (total or 0.0) for compte_id, monnaie_id, total in rows}


def get_soldes_comptes(db: Session, date_fin: Optional[date_type] = None):
    """Un élément par compte, chacun portant un solde PAR MONNAIE :

        [{"compte": <Compte>, "soldes": {monnaie_id: {"monnaie": <Monnaie>,
                                                      "solde_initial": ...,
                                                      "solde_reel": ...,
                                                      "solde_projete": ...}}}]

    Les monnaies déclarées sur le compte apparaissent toutes, même sans aucune
    opération (leur solde vaut alors le solde initial) : c'est ce qui rend
    visible un compte en dollars fraîchement ouvert.

    `date_fin` borne la **projection** : le solde projeté ne tient compte que
    des opérations jusqu'à cette date incluse. Sans borne, le projeté intégrait
    toutes les opérations futures connues, y compris les occurrences récurrentes
    générées jusqu'à 24 mois à l'avance — il ne répondait donc pas à "où j'en
    serai à la fin de la période affichée", mais à "où j'en serai une fois tout
    l'horizon écoulé".

    Le solde **réel** n'est jamais borné : il ne compte que des opérations au
    statut réel, déjà survenues par construction.
    """
    # Dans l'ordre choisi par l'utilisateur (crud.get_comptes) : les cartes du
    # dashboard se rangent alors comme les lignes de la page Comptes, type par
    # type — c'est là que cet ordre se décide.
    comptes = crud.get_comptes(db)
    sums_reel = _sums_by_compte_monnaie_and_sens(db, statut=Statut.reel)
    sums_total = _sums_by_compte_monnaie_and_sens(db, statut=None, date_fin=date_fin)
    reste_prets = _reste_du_prets_par_compte_monnaie(db, date_fin=date_fin)

    results = []
    for compte in comptes:
        soldes_initiaux = {lien.monnaie_id: lien.solde_initial for lien in compte.monnaies}
        monnaies = {lien.monnaie_id: lien.monnaie for lien in compte.monnaies}
        soldes = {}
        for monnaie_id, monnaie in monnaies.items():
            cle = (compte.id, monnaie_id)
            solde_initial = soldes_initiaux[monnaie_id]
            soldes[monnaie_id] = {
                "monnaie": monnaie,
                "solde_initial": solde_initial,
                "solde_reel": solde_initial + _solde_delta(sums_reel.get(cle, {})),
                "solde_projete": (
                    solde_initial
                    + _solde_delta(sums_total.get(cle, {}))
                    - reste_prets.get(cle, 0.0)
                ),
            }
        results.append({"compte": compte, "soldes": soldes})
    return results


def calculer_totaux_par_monnaie(
    comptes_soldes: list[dict], valorisation_placements: Optional[dict] = None
) -> dict:
    """À partir du résultat de get_soldes_comptes : les totaux du dashboard,
    **par monnaie**.

    solde_total_courant / solde_projete_courant sont limités aux comptes du
    budget courant (l'épargne et les comptes-titres ne sont soumis qu'à des
    virements internes — et à des achats/ventes de titres pour les seconds).
    total_avoirs est la seule valeur qui les inclut, pour voir le patrimoine
    complet ; il ajoute la valorisation des portefeuilles, car sur un
    compte-titres le solde du compte ne reflète que les espèces qui y dorment,
    et l'essentiel de l'avoir est justement ce qui n'y est plus.

    `valorisation_placements` est un dict {monnaie_id: montant} : un titre est
    coté dans une monnaie, sa valorisation ne peut donc entrer que dans le total
    de celle-là.
    """
    valorisation_placements = valorisation_placements or {}
    totaux: dict = {}

    def _entree(monnaie_id: int) -> dict:
        return totaux.setdefault(
            monnaie_id,
            {
                "solde_total_courant": 0.0,
                "solde_projete_courant": 0.0,
                "total_avoirs": 0.0,
                "valorisation_placements": 0.0,
            },
        )

    for item in comptes_soldes:
        est_courant = item["compte"].type_nom not in TYPES_COMPTE_HORS_COURANT
        for monnaie_id, solde in item["soldes"].items():
            entree = _entree(monnaie_id)
            entree["total_avoirs"] += solde["solde_reel"]
            if est_courant:
                entree["solde_total_courant"] += solde["solde_reel"]
                entree["solde_projete_courant"] += solde["solde_projete"]

    for monnaie_id, valorisation in valorisation_placements.items():
        entree = _entree(monnaie_id)
        entree["valorisation_placements"] += valorisation
        entree["total_avoirs"] += valorisation

    return totaux


def _filtre_periode(annee: int, mois: Optional[int]):
    """mois=None : agrège sur toute l'année plutôt qu'un mois précis (vue
    annuelle du dashboard) — même colonne de date, seul le format strftime
    change (comparaison sur l'année seule).

    LES OPÉRATIONS AMORTIES SONT EXCLUES ICI, et c'est le point : pour elles, la
    date ne dit plus QUAND la dépense pèse, seulement quand l'argent est sorti.
    Ce qu'elles apportent à la période se calcule à part
    (_filtre_periode_amortie + part_amortie), et les compter aussi par leur date
    les ferait peser deux fois sur leur mois d'origine. L'exclusion est posée
    dans ce filtre plutôt qu'à chaque appel : les deux agrégats de période
    (histogramme par catégorie, flux entrées/sorties) doivent l'appliquer, et
    aucun futur appelant n'a de raison de vouloir l'inverse."""
    if mois is None:
        filtre_date = func.strftime("%Y", models.Operation.date) == f"{annee:04d}"
    else:
        filtre_date = (
            func.strftime("%Y-%m", models.Operation.date) == f"{annee:04d}-{mois:02d}"
        )
    return and_(models.Operation.amorti.is_(False), filtre_date)


# ---------- Amortissement sur plusieurs mois ----------
#
# Une opération amortie n'existe qu'en un seul exemplaire (cf. models.Operation)
# : ni occurrences générées, ni montant redécoupé en base. Ce sont les agrégats
# de période qui, en les rencontrant, n'en prennent qu'une fraction — celle des
# mois d'amortissement qui tombent dans la période affichée.
#
# Ne sont concernés que les agrégats de PÉRIODE (histogramme des dépenses par
# catégorie, KPI entrées / sorties / différence). Les soldes du haut de page
# n'en tiennent aucun compte, et ne le doivent pas : ils disent où en sont
# réellement les comptes, or l'argent est bien parti en une fois.


def _index_mois(d: date_type) -> int:
    """Numérote les mois d'affilée depuis l'an 0, pour que deux mois se
    comparent et se soustraient sans se soucier du passage d'année."""
    return d.year * 12 + d.month


def _bornes_periode_en_mois(annee: int, mois: Optional[int]) -> tuple[int, int]:
    """Premier et dernier mois de la période affichée, en index de mois."""
    if mois is None:
        return _index_mois(date_type(annee, 1, 1)), _index_mois(date_type(annee, 12, 1))
    borne = _index_mois(date_type(annee, mois, 1))
    return borne, borne


def _filtre_periode_amortie(annee: int, mois: Optional[int]):
    """Les opérations amorties dont la plage recoupe la période — le pendant de
    _filtre_periode pour elles.

    Le chevauchement se teste en SQL (deux comparaisons de dates) plutôt qu'en
    Python : c'est ce qui évite de charger toutes les opérations amorties de la
    base à chaque affichage du dashboard. Les bornes sont normalisées au 1er du
    mois (cf. schemas.OperationBase), la comparaison au premier et au dernier
    jour de la période est donc exacte."""
    debut_periode = date_type(annee, 1 if mois is None else mois, 1)
    fin_periode = fin_de_periode(annee, mois)
    return and_(
        models.Operation.amorti.is_(True),
        models.Operation.amortissement_debut <= fin_periode,
        models.Operation.amortissement_fin >= debut_periode,
    )


def part_amortie(operation: models.Operation, annee: int, mois: Optional[int]) -> float:
    """Quelle FRACTION du montant d'une opération amortie revient à la période
    (0 si elle n'y déborde pas, 1 si toute sa plage y tient).

    Une fraction plutôt qu'un montant : l'appelant décide de ce qu'il étale.
    L'histogramme n'impute pas le montant d'une dépense remboursable mais son
    reste à charge (montant − montant dû) ; renvoyer ici un montant tout fait
    aurait obligé à traiter ce cas deux fois, ou à l'oublier une fois.

    En vue annuelle, la période compte douze mois : un amortissement à cheval
    sur deux années n'apporte à chacune que les mois qui lui reviennent — c'est
    exactement ce que la vue annuelle doit montrer."""
    nb_mois = operation.amortissement_nb_mois
    if not nb_mois:
        return 0.0
    debut_periode, fin_periode = _bornes_periode_en_mois(annee, mois)
    debut_amortissement = _index_mois(operation.amortissement_debut)
    fin_amortissement = _index_mois(operation.amortissement_fin)
    mois_couverts = min(fin_amortissement, fin_periode) - max(
        debut_amortissement, debut_periode
    ) + 1
    if mois_couverts <= 0:
        return 0.0
    return mois_couverts / nb_mois


def _sommes_par_categorie(
    db: Session, annee: int, mois: Optional[int], statut: Statut, monnaie_id: int
) -> dict:
    """Pour une période (mois précis, ou année entière si mois=None), un statut
    et une monnaie donnés : somme des opérations classiques + somme (montant -
    montant dû) des dépenses remboursables, par catégorie."""
    filtre_commun = [
        models.Operation.sens == Sens.depense,
        models.Operation.statut == statut,
        models.Operation.monnaie_id == monnaie_id,
        _filtre_periode(annee, mois),
    ]

    classiques = (
        db.query(models.Categorie.nom, func.sum(models.Operation.montant).label("total"))
        .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(models.TypeOperationDB.code.notin_(_CODES_REMBOURSABLES), *filtre_commun)
        .group_by(models.Categorie.nom)
        .all()
    )
    remboursables = (
        db.query(
            models.Categorie.nom,
            func.sum(models.Operation.montant - models.Operation.montant_du).label("total"),
        )
        .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(models.TypeOperationDB.code.in_(_CODES_REMBOURSABLES), *filtre_commun)
        .group_by(models.Categorie.nom)
        .all()
    )

    totaux: dict = {}
    for nom, total in classiques:
        totaux[nom] = totaux.get(nom, 0.0) + (total or 0.0)
    for nom, total in remboursables:
        totaux[nom] = totaux.get(nom, 0.0) + (total or 0.0)
    for nom, total in _sommes_amorties_par_categorie(
        db, annee, mois, statut, monnaie_id
    ).items():
        totaux[nom] = totaux.get(nom, 0.0) + total
    return totaux


def _sommes_amorties_par_categorie(
    db: Session, annee: int, mois: Optional[int], statut: Statut, monnaie_id: int
) -> dict:
    """Ce que les opérations AMORTIES apportent à la période, par catégorie —
    le complément de _sommes_par_categorie, qui les exclut (cf. _filtre_periode).

    L'agrégation se fait en Python et non en SQL : la part imputée dépend du
    nombre de mois d'amortissement tombant dans la période, que SQLite ne sait
    calculer qu'au prix d'une arithmétique de dates illisible. Le filtre de
    chevauchement, lui, reste en SQL — c'est lui qui borne le nombre de lignes
    remontées à celles qui pèsent réellement sur la période."""
    lignes = (
        db.query(models.Categorie.nom, models.Operation, models.TypeOperationDB.code)
        .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(
            models.Operation.sens == Sens.depense,
            models.Operation.statut == statut,
            models.Operation.monnaie_id == monnaie_id,
            _filtre_periode_amortie(annee, mois),
        )
        .all()
    )

    totaux: dict = {}
    for nom, operation, code in lignes:
        # Même base imposable que pour les non amorties (cf. _base_imposable) :
        # le montant, sauf pour une dépense remboursable, dont seule la part
        # restant à ma charge est une dépense.
        base = _base_imposable(operation.montant, operation.montant_du, code)
        totaux[nom] = totaux.get(nom, 0.0) + base * part_amortie(operation, annee, mois)
    return totaux


# Combien de dépenses l'infobulle d'une barre de l'histogramme détaille. Trois :
# assez pour dire ce qui fait le montant de la barre, assez peu pour se lire
# d'un coup d'œil sans que l'infobulle recouvre le graphique.
NB_TOP_DEPENSES = 3


def _base_imposable(montant: float, montant_du: Optional[float], code: str) -> float:
    """Ce qu'une opération apporte à l'histogramme : son montant, sauf pour une
    dépense remboursable (ou un prêt reçu), dont seule la part restant à ma
    charge est une dépense.

    Extrait ici parce que trois calculs devaient déjà s'accorder sur cette
    règle — les sommes par catégorie, leur pendant amorti, et maintenant le
    détail par libellé. Une infobulle qui compterait le montant entier d'une
    dépense remboursable annoncerait des lignes dont la somme dépasserait la
    barre qu'elles détaillent."""
    if code in _CODES_REMBOURSABLES:
        return montant - (montant_du or 0.0)
    return montant


def _fondre_par_libelle(cumuls: dict, categorie: str, nature: str, montant: float) -> None:
    """Ajoute une dépense au cumul {catégorie: {libellé: [montant, nombre]}}.

    LE LIBELLÉ EST PRIS TEL QUEL, aux espaces de bord près : « Café » et
    « CAFE » restent deux dépenses distinctes. C'est la même règle que la
    détection de doublons d'import (cf. import_bancaire.normaliser_pour_
    comparaison) — confondre deux libellés visiblement différents reviendrait à
    décider à la place de l'utilisateur qu'ils n'en font qu'un."""
    libelle = (nature or "").strip()
    par_libelle = cumuls.setdefault(categorie, {})
    entree = par_libelle.setdefault(libelle, [0.0, 0])
    entree[0] += montant
    entree[1] += 1


def _top_depenses_par_categorie(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> dict[str, list[dict]]:
    """Les plus grosses dépenses de la période, par catégorie et fondues par
    libellé — ce que montre l'infobulle d'une barre de l'histogramme.

    MÊME PÉRIMÈTRE QUE LA BARRE, ET C'EST TOUT L'ENJEU : mêmes filtres (sens,
    monnaie, période), même base imposable, et les deux statuts confondus —
    réel ET prévisionnel — parce que c'est la hauteur totale de la barre que
    l'infobulle détaille. Ne prendre que le réel aurait fait survoler une barre
    et lire des lignes qui n'en expliquent qu'une partie.

    Les opérations AMORTIES comptent pour leur seule part de la période, comme
    partout ailleurs (cf. part_amortie) : une facture de 1 200 € étalée sur
    douze mois apparaît à 100 € dans le mois qu'on regarde, pas à 1 200 €.

    L'agrégation se fait en Python : fondre par libellé APRÈS avoir appliqué la
    part amortie ne se dit pas en SQL sans réécrire part_amortie en
    arithmétique de dates. Le volume reste celui d'une période (un mois, ou une
    année) pour une seule monnaie."""
    filtre_commun = [
        models.Operation.sens == Sens.depense,
        models.Operation.monnaie_id == monnaie_id,
    ]
    colonnes = (
        models.Categorie.nom,
        models.Operation.nature,
        models.Operation.montant,
        models.Operation.montant_du,
        models.TypeOperationDB.code,
    )

    def requete(filtre_periode):
        return (
            db.query(*colonnes)
            .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
            .join(
                models.TypeOperationDB,
                models.Operation.type_id == models.TypeOperationDB.id,
            )
            .filter(filtre_periode, *filtre_commun)
        )

    cumuls: dict = {}
    for categorie, nature, montant, montant_du, code in requete(
        _filtre_periode(annee, mois)
    ).all():
        _fondre_par_libelle(
            cumuls, categorie, nature, _base_imposable(montant, montant_du, code)
        )

    # Les amorties, avec la même colonne d'opération en plus : part_amortie a
    # besoin de l'objet, pas seulement de ses montants.
    amorties = (
        db.query(models.Categorie.nom, models.Operation, models.TypeOperationDB.code)
        .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(_filtre_periode_amortie(annee, mois), *filtre_commun)
        .all()
    )
    for categorie, operation, code in amorties:
        part = _base_imposable(
            operation.montant, operation.montant_du, code
        ) * part_amortie(operation, annee, mois)
        _fondre_par_libelle(cumuls, categorie, operation.nature, part)

    resultats: dict[str, list[dict]] = {}
    for categorie, par_libelle in cumuls.items():
        classees = sorted(
            (
                {"nature": libelle, "montant": montant, "nombre": nombre}
                for libelle, (montant, nombre) in par_libelle.items()
                # Une catégorie peut porter des lignes à 0 (dépense remboursable
                # intégralement due, amortie hors période) : elles ne détaillent
                # rien et occuperaient une des trois places.
                if montant > 0
            ),
            # Le libellé départage deux montants égaux : sans lui, deux
            # affichages successifs des mêmes données pourraient ne pas donner
            # le même ordre.
            key=lambda d: (-d["montant"], d["nature"]),
        )
        resultats[categorie] = classees[:NB_TOP_DEPENSES]
    return resultats


def _budget_alloue_periode(
    db: Session, categorie_id: int, annee: int, mois: Optional[int], monnaie_id: int
) -> float:
    """Budget d'un mois précis, ou somme des 12 mois de l'année si mois=None
    (vue annuelle) — chaque mois résolu par héritage habituel, dans la monnaie
    demandée (cf. crud.get_budget_categorie)."""
    if mois is not None:
        return crud.get_budget_categorie(db, categorie_id, annee, mois, monnaie_id)
    return sum(
        crud.get_budget_categorie(db, categorie_id, annee, m, monnaie_id)
        for m in range(1, 13)
    )


def get_depenses_par_categorie(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
):
    """Valeur réelle = opérations classiques (réel) + (montant - montant dû)
    des dépenses remboursables (réel), pour la période et la monnaie données.
    Valeur prévisionnelle = valeur réelle + la même formule en statut
    prévisionnel.

    Toutes les catégories sont concernées : depuis 0019 la table n'en contient
    plus que de vraies (les quatre anciennes catégories système sont devenues
    des types, et leurs opérations n'ont plus de catégorie du tout).

    Sauf celles que l'utilisateur a éteintes (œil de l'onglet Catégories) : le
    filtre est ici, à la source, plutôt que côté frontend, pour que l'échelle de
    l'histogramme se recalcule sur les seules barres montrées — masquer après
    coup aurait laissé une catégorie invisible écraser toutes les autres."""
    categories = (
        db.query(models.Categorie)
        .filter(models.Categorie.visible_dashboard.is_(True))
        .order_by(models.Categorie.ordre)
        .all()
    )

    reel = _sommes_par_categorie(db, annee, mois, Statut.reel, monnaie_id)
    previsionnel_seul = _sommes_par_categorie(
        db, annee, mois, Statut.previsionnel, monnaie_id
    )
    # Calculé une fois pour toutes les catégories, pas une requête par barre.
    tops = _top_depenses_par_categorie(db, annee, mois, monnaie_id)

    resultats = []
    for categorie in categories:
        valeur_reelle = reel.get(categorie.nom, 0.0)
        valeur_previsionnelle = valeur_reelle + previsionnel_seul.get(categorie.nom, 0.0)
        resultats.append(
            {
                "categorie": categorie.nom,
                "total_reel": valeur_reelle,
                "total_previsionnel": valeur_previsionnelle,
                "budget_alloue": _budget_alloue_periode(
                    db, categorie.id, annee, mois, monnaie_id
                ),
                "couleur_index": categorie.couleur_index,
                "top_depenses": tops.get(categorie.nom, []),
            }
        )
    return resultats


def get_flux_periode(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> dict:
    """Ce qui est entré, ce qui est sorti, et leur différence, pour la période
    et la monnaie données — réel et prévisionnel confondus.

    LES VIREMENTS INTERNES SONT EXCLUS PAR CONSTRUCTION, et c'est le point de
    cette fonction : le filtre porte sur `sens IN (entrée, dépense)`, il ne se
    contente pas d'espérer qu'aucun transfert ne s'y glisse. Un virement déplace
    de l'argent entre mes propres comptes sans changer mon solde global ; le
    compter d'un côté sans l'autre gonflerait aussi bien les entrées que les
    sorties. La version précédente soustrayait deux totaux groupés par sens sans
    filtrer : elle donnait le bon résultat tant que rien d'autre que
    `transfert_*` ne portait un virement, mais rien ne le garantissait — le
    calcul dépendait d'une absence plutôt que d'une règle.

    Les achats et ventes de titres sont eux aussi des `transfert_*` (acheter des
    titres convertit l'argent, ne le dépense pas) : ils tombent sous le même
    filtre.

    Les comptes d'épargne et de placements sont écartés à part : ils ne
    reçoivent que des virements internes, donc rien qui puisse compter ici, mais
    les exclure explicitement garde le total cohérent avec les KPI de solde, qui
    les excluent aussi.

    Renvoie un dict plutôt qu'un seul nombre : le dashboard affiche désormais
    les deux composantes à côté de leur différence, et les recalculer
    séparément ouvrirait la porte à trois chiffres qui ne s'accordent pas.

    Les opérations amorties comptent pour leur seule part de la période (cf.
    part_amortie), et non pour leur montant entier au mois où l'argent est
    sorti : ces trois chiffres répondent à « qu'est-ce que cette période me
    coûte », pas à « qu'est-ce qui est passé sur le compte » — sans quoi
    amortir n'aurait d'effet que sur l'histogramme, qui cesserait aussitôt de
    s'accorder avec le total des sorties juste à côté."""
    filtres_communs = [
        models.Operation.monnaie_id == monnaie_id,
        models.TypeCompte.nom.notin_(TYPES_COMPTE_HORS_COURANT),
        models.Operation.sens.in_([Sens.entree, Sens.depense]),
    ]
    rows = (
        db.query(models.Operation.sens, func.sum(models.Operation.montant).label("total"))
        .join(models.Compte, models.Operation.compte_id == models.Compte.id)
        .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
        .filter(_filtre_periode(annee, mois), *filtres_communs)
        .group_by(models.Operation.sens)
        .all()
    )
    totaux = {sens: (total or 0.0) for sens, total in rows}

    amorties = (
        db.query(models.Operation)
        .join(models.Compte, models.Operation.compte_id == models.Compte.id)
        .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
        .filter(_filtre_periode_amortie(annee, mois), *filtres_communs)
        .all()
    )
    for operation in amorties:
        totaux[operation.sens] = totaux.get(operation.sens, 0.0) + (
            operation.montant * part_amortie(operation, annee, mois)
        )

    entrees = totaux.get(Sens.entree, 0.0)
    sorties = totaux.get(Sens.depense, 0.0)
    return {"entrees": entrees, "sorties": sorties, "variation": entrees - sorties}


def get_variation_previsionnelle(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> float:
    """Entrées moins sorties de la période : d'un coup d'œil, la période
    s'annonce-t-elle positive ou négative. Voir get_flux_periode, dont ce n'est
    qu'une des trois valeurs."""
    return get_flux_periode(db, annee, mois, monnaie_id)["variation"]


def get_total_a_rembourser(db: Session) -> dict:
    """Net de ce qu'on me doit, PAR MONNAIE : dépenses remboursables encore
    dues, moins ce que je dois moi-même sur des prêts qu'on m'a accordés. Une
    dette en dollars ne compense pas une créance en euros, d'où le dict."""
    totaux: dict = {}

    du_par_depenses = (
        db.query(
            models.Operation.monnaie_id, func.sum(models.Operation.montant_a_rembourser)
        )
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(
            models.Operation.sens == Sens.depense,
            models.TypeOperationDB.code == TypeOperation.remboursable.value,
            models.Operation.statut == Statut.reel,
        )
        .group_by(models.Operation.monnaie_id)
        .all()
    )
    for monnaie_id, total in du_par_depenses:
        totaux[monnaie_id] = totaux.get(monnaie_id, 0.0) + (total or 0.0)

    du_par_prets = (
        db.query(
            models.Operation.monnaie_id, func.sum(models.Operation.montant_a_rembourser)
        )
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(models.TypeOperationDB.code == TypeOperation.pret.value)
        .group_by(models.Operation.monnaie_id)
        .all()
    )
    for monnaie_id, total in du_par_prets:
        totaux[monnaie_id] = totaux.get(monnaie_id, 0.0) - (total or 0.0)

    return totaux
