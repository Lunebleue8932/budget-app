from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..constants import TYPES_COMPTE_HORS_COURANT, Sens
from ..database import get_db
from ..services import cascade, periode_tout, placements, soldes

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/note", response_model=schemas.NoteDashboardRead)
def get_note(db: Session = Depends(get_db)):
    """Le bloc-notes libre affiché en bas du dashboard.

    Déclaré AVANT la route racine n'est pas nécessaire ici (les chemins ne se
    recouvrent pas), mais le groupe reste ensemble pour se lire d'un bloc."""
    note = crud.get_note_dashboard(db)
    if note is None:
        return schemas.NoteDashboardRead()
    return schemas.NoteDashboardRead(contenu=note.contenu, modifie_le=note.modifie_le)


@router.put("/note", response_model=schemas.NoteDashboardRead)
def set_note(payload: schemas.NoteDashboardUpdate, db: Session = Depends(get_db)):
    """Enregistrement automatique côté frontend : cet endpoint est appelé à
    chaque pause de frappe, il doit donc rester trivial (une seule ligne
    réécrite, aucun recalcul déclenché)."""
    note = crud.set_note_dashboard(db, payload.contenu)
    return schemas.NoteDashboardRead(contenu=note.contenu, modifie_le=note.modifie_le)


def _periode_demandee(annee: Optional[int], mois: Optional[int]) -> tuple[int, int]:
    """Le mois demandé, ou le mois courant. Les trois routes du budget total
    partagent cette résolution : elles écrivent et relisent la MÊME case, et
    deux façons de deviner la période auraient fini par les faire diverger d'un
    mois au passage de minuit du 31."""
    aujourdhui = date.today()
    annee_resolue = annee if annee is not None else aujourdhui.year
    mois_resolu = mois if mois is not None else aujourdhui.month
    if mois_resolu < 1 or mois_resolu > 12:
        raise HTTPException(status_code=400, detail="mois doit être entre 1 et 12")
    return annee_resolue, mois_resolu


@router.get("/budget-total", response_model=schemas.BudgetTotalRead)
def lire_budget_total(
    monnaie_id: int,
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Le budget de tout un mois, résolu par héritage (cf. crud._budget_herite).

    LE DASHBOARD LE REÇOIT DÉJÀ avec ses KPI : cette route sert au FORMULAIRE,
    qui a besoin de savoir en plus si le montant est posé pour ce mois-ci ou
    hérité d'un autre — un budget hérité affiché sans le dire passe pour une
    saisie oubliée."""
    annee, mois = _periode_demandee(annee, mois)
    return schemas.BudgetTotalRead(
        annee=annee,
        mois=mois,
        monnaie_id=monnaie_id,
        montant=crud.get_budget_total(db, annee, mois, monnaie_id),
        explicite=crud.budget_total_est_explicite(db, annee, mois, monnaie_id),
    )


@router.put("/budget-total", response_model=schemas.BudgetTotalRead)
def ecrire_budget_total(
    payload: schemas.BudgetTotalUpdate,
    monnaie_id: int,
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Pose le budget du mois. Zéro le retire de fait — la vue « budget » du
    camembert disparaît, faute de dénominateur.

    RIEN N'EST REFUSÉ ICI, même si le montant contredit les budgets de
    catégorie déjà posés : c'est le rôle de `GET /dashboard/coherence-budgets`,
    que l'écran interroge juste après. Refuser aurait obligé à corriger les
    vingt catégories AVANT de pouvoir écrire le total, c'est-à-dire dans
    l'ordre exactement inverse de celui où l'on pense."""
    annee, mois = _periode_demandee(annee, mois)
    crud.set_budget_total(db, annee, mois, monnaie_id, payload.montant)
    return schemas.BudgetTotalRead(
        annee=annee,
        mois=mois,
        monnaie_id=monnaie_id,
        montant=payload.montant,
        explicite=True,
    )


@router.get("/coherence-budgets", response_model=schemas.IncoherencesBudgetsRead)
def lire_coherence_budgets(
    monnaie_id: int,
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Les catégories dont les trois grandeurs du budget se contredisent.

    INTERROGÉE APRÈS CHAQUE SAISIE des trois — budget total, budget d'une
    catégorie, objectif en pourcentage — et jamais au chargement d'un écran :
    c'est une réaction à ce qu'on vient d'écrire, pas un reproche permanent
    affiché à l'ouverture."""
    annee, mois = _periode_demandee(annee, mois)
    return schemas.IncoherencesBudgetsRead(
        **crud.incoherences_budgets(db, annee, mois, monnaie_id)
    )


@router.get("/ecart-variations", response_model=schemas.EcartVariationsRead)
def get_ecart_variations(
    monnaie_id: int,
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    tout: bool = False,
    db: Session = Depends(get_db),
):
    """Les opérations qui expliquent l'écart entre les deux variations du
    dashboard (cf. services.soldes.get_ecart_variations).

    UNE ROUTE À PART, et pas un champ de plus sur `/dashboard`. Ce détail n'est
    demandé que lorsqu'on clique pour le voir : le calculer à chaque affichage du
    dashboard aurait chargé toutes les opérations de la période à chaque
    changement de mois, pour une liste que personne ne regarde neuf fois sur dix.
    Même raisonnement que `/dashboard/semaines`.

    UNE SEULE MONNAIE, obligatoire : l'application n'additionne jamais deux
    monnaies, et cet écran détaille l'onglet qu'on regarde déjà.

    `mois=None` DONNE LA VUE ANNUELLE, exactement comme le dashboard : les deux
    variations s'y calculent sur douze mois, leur écart aussi.
    """
    aujourdhui = date.today()
    annee = annee if annee is not None else aujourdhui.year
    if mois is not None and (mois < 1 or mois > 12):
        raise HTTPException(status_code=400, detail="mois doit être entre 1 et 12")
    if tout:
        # « Tout » : la somme des vues annuelles (cf. services/periode_tout).
        return periode_tout.ecart_variations_tout(
            db, periode_tout.annees_couvertes(db, aujourdhui), monnaie_id
        )
    return soldes.get_ecart_variations(db, annee, mois, monnaie_id)


@router.get("/semaines", response_model=schemas.DepensesSemainesRead)
def get_depenses_semaines(
    monnaie_id: int,
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """L'histogramme des dépenses d'un mois, DÉPLIÉ en semaines.

    Déclaré AVANT la route racine n'est pas nécessaire (les chemins ne se
    recouvrent pas), mais la route reste ici, à côté du dashboard qu'elle
    détaille.

    UNE SEULE MONNAIE, et elle est obligatoire : l'app n'additionne jamais deux
    monnaies, et cette vue détaille l'onglet de monnaie qu'on regarde déjà — il
    n'y a pas de raison de calculer les onze autres pour n'en montrer qu'une.

    PAS DE VUE ANNÉE : les semaines découpent un MOIS. Déplier une année en
    cinquante-deux barres ne serait plus un histogramme, et « la moyenne des
    semaines du mois » n'aurait plus de mois.
    """
    aujourdhui = date.today()
    annee = annee if annee is not None else aujourdhui.year
    mois = mois if mois is not None else aujourdhui.month
    if mois < 1 or mois > 12:
        raise HTTPException(status_code=400, detail="mois doit être entre 1 et 12")

    # Même topping-up que le dashboard : cette route se lit sans être passée par
    # lui (rechargement de page sur l'histogramme déplié).
    crud.generer_occurrences_recurrentes(db)
    return soldes.get_depenses_par_semaine(db, annee, mois, monnaie_id)


@router.get("/semaines/annee", response_model=schemas.MoyenneAnnuelleDepensesRead)
def get_moyenne_annee(
    monnaie_id: int,
    annee: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """La moyenne hebdomadaire des dépenses d'une ANNÉE (cf.
    soldes.get_depenses_moyenne_annee).

    UNE ROUTE À PART de `/dashboard/semaines` : elle parcourt les douze mois, et
    l'imposer à chaque changement de mois aurait ralenti tout le dépliant pour une
    moyenne qu'on ne regarde qu'à la demande. L'écran la lit au clic sur l'onglet.
    Même monnaie obligatoire : l'application n'en additionne jamais deux."""
    annee = annee if annee is not None else date.today().year
    crud.generer_occurrences_recurrentes(db)
    return soldes.get_depenses_moyenne_annee(db, annee, monnaie_id)


@router.get("/semaines/moyenne", response_model=schemas.MoyenneDepensesPeriodeRead)
def get_moyenne_periode(
    monnaie_id: int,
    vue: str = "mois",
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """La moyenne hebdomadaire de l'ensemble que le niveau du dashboard désigne.

    UN SEUL RÉGLAGE : la fenêtre est le niveau où l'on se trouve (`mois`, `annee`
    ou `tout`), comme pour les cartes d'objectifs — là où il fallait auparavant
    choisir entre « Moyenne » et « Moyenne de l'année », deux boutons pour une
    question qui n'en pose qu'une. Cf. soldes.get_depenses_moyenne_periode.

    Même monnaie obligatoire que les autres routes de semaines."""
    if vue not in ("mois", "annee", "tout"):
        raise HTTPException(
            status_code=400, detail="vue doit être 'mois', 'annee' ou 'tout'"
        )
    aujourdhui = date.today()
    annee = annee if annee is not None else aujourdhui.year
    mois = mois if mois is not None else aujourdhui.month
    if mois < 1 or mois > 12:
        raise HTTPException(status_code=400, detail="mois doit être entre 1 et 12")
    crud.generer_occurrences_recurrentes(db)
    return soldes.get_depenses_moyenne_periode(db, vue, annee, mois, monnaie_id)


def _bornes_vue(vue: str, annee: Optional[int], mois: Optional[int]):
    """(début, fin) d'une période du dashboard, ou (None, None) pour « tout »."""
    if vue not in ("mois", "annee", "tout"):
        raise HTTPException(
            status_code=400, detail="vue doit être 'mois', 'annee' ou 'tout'"
        )
    if vue == "tout":
        return None, None
    aujourdhui = date.today()
    annee = annee if annee is not None else aujourdhui.year
    if vue == "annee":
        return date(annee, 1, 1), date(annee, 12, 31)
    mois = mois if mois is not None else aujourdhui.month
    if mois < 1 or mois > 12:
        raise HTTPException(status_code=400, detail="mois doit être entre 1 et 12")
    return date(annee, mois, 1), soldes.fin_de_periode(annee, mois)


@router.get("/cascade", response_model=schemas.CascadeMonnaie)
def get_cascade(
    monnaie_id: int,
    vue: str = "mois",
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """La CASCADE d'une monnaie sur une période (cf. services/cascade.py) :
    ses catégories, son épargne, ses frais de virements et ses conversions vers
    chaque autre monnaie.

    CE QUE LE DASHBOARD EN FAIT, et seulement quand les monnaies éteintes
    s'affichent « en pop-up » (Paramètres généraux) : la fenêtre de détail d'une
    monnaie éteinte, et les colonnes « Conversion vers… » que l'histogramme d'une
    monnaie allumée gagne à sa place.

    LES MONTANTS QUI ONT BOUGÉ, à leur date — ni étalement d'une dépense amortie,
    ni reste à charge d'une remboursable : une cascade raconte ce qui est entré
    et sorti, pas ce qu'un mois coûte (ça, c'est l'histogramme)."""
    debut, fin = _bornes_vue(vue, annee, mois)
    crud.generer_occurrences_recurrentes(db)
    monnaie = crud.get_monnaie(db, monnaie_id)
    if monnaie is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    requete = db.query(models.Operation).filter(models.Operation.monnaie_id == monnaie_id)
    if debut is not None:
        requete = requete.filter(models.Operation.date >= debut, models.Operation.date <= fin)
    trouvee = next(
        (c for c in cascade.cascades(db, requete.all()) if c["monnaie_id"] == monnaie_id),
        None,
    )
    if trouvee is None:
        return schemas.CascadeMonnaie(
            monnaie_id=monnaie.id,
            monnaie_nom=monnaie.nom,
            monnaie_symbole=monnaie.symbole,
            monnaie_active=bool(monnaie.active),
        )
    return trouvee


@router.get("/frais-virements", response_model=list[schemas.VirementFraisRead])
def get_frais_virements(db: Session = Depends(get_db)):
    """TOUS les frais qui comptent comme une dépense (cf. soldes._lignes_frais_virements),
    du plus récent au plus ancien : ceux des VIREMENTS INTERNES — une paire par virement,
    les frais lus sur la jambe qui les porte (une seule, cf. crud._jambe_des_frais), dans
    SA monnaie — et ceux des opérations d'un compte d'ÉPARGNE ou de PLACEMENTS, qui n'ont
    qu'une jambe (`entrante` vide). La fenêtre « Frais » (projets et dashboard) les filtre
    elle-même par période, monnaie et compte : il y en a peu, et elle change de filtre
    sans refaire d'aller-retour."""
    def jambe(op):
        return schemas.JambeFraisRead(
            operation_id=op.id, compte_id=op.compte_id, monnaie_id=op.monnaie_id, montant=op.montant
        )

    def statut(op):
        return op.statut.value if hasattr(op.statut, "value") else op.statut

    portant = (
        db.query(models.Operation)
        .join(models.Compte, models.Operation.compte_id == models.Compte.id)
        .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
        .filter(models.Operation.frais > 0)
        .all()
    )
    resultat = []
    virements = {op.virement_id for op in portant if op.virement_id and op.type_code == "virement"}
    for op in portant:
        if op.virement_id in virements:
            continue
        if op.compte.type_nom not in TYPES_COMPTE_HORS_COURANT:
            continue  # les frais d'une opération ordinaire sont dans son montant
        resultat.append(
            schemas.VirementFraisRead(
                virement_id=f"op-{op.id}",
                date=op.date,
                nature=op.nature or "",
                statut=statut(op),
                sortante=jambe(op),
                entrante=None,
                frais=op.frais,
                monnaie_frais_id=op.monnaie_id,
            )
        )
    if virements:
        par_virement: dict[str, list] = {}
        for op in db.query(models.Operation).filter(models.Operation.virement_id.in_(virements)):
            par_virement.setdefault(op.virement_id, []).append(op)
        for virement_id, paire in par_virement.items():
            sortante = next((j for j in paire if j.sens == Sens.transfert_sortant), None)
            entrante = next((j for j in paire if j.sens == Sens.transfert_entrant), None)
            grevee = next((j for j in paire if j.frais and j.frais > 0), None)
            if grevee is None or (sortante is None and entrante is None):
                continue
            premiere = sortante or entrante
            resultat.append(
                schemas.VirementFraisRead(
                    virement_id=virement_id,
                    date=premiere.date,
                    nature=premiere.nature or "",
                    statut=statut(premiere),
                    sortante=jambe(premiere),
                    entrante=jambe(entrante) if sortante is not None and entrante is not None else None,
                    frais=grevee.frais,
                    monnaie_frais_id=grevee.monnaie_id,
                )
            )
    resultat.sort(key=lambda v: (v.date, v.virement_id), reverse=True)
    return resultat


@router.get("/cascade/periodes", response_model=list[schemas.PeriodeRead])
def get_periodes_monnaie(monnaie_id: int, db: Session = Depends(get_db)):
    """Les mois qui portent au moins une opération dans cette monnaie, du plus
    récent au plus ancien — les seuls que le sélecteur de la fenêtre de détail
    propose : un mois vide n'y aurait rien à montrer."""
    mois = {
        (d.year, d.month)
        for (d,) in db.query(models.Operation.date).filter(
            models.Operation.monnaie_id == monnaie_id
        )
    }
    return [
        schemas.PeriodeRead(annee=a, mois=m) for a, m in sorted(mois, reverse=True)
    ]


@router.get("", response_model=schemas.DashboardRead)
def get_dashboard(
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    vue: str = "mois",
    db: Session = Depends(get_db),
):
    # Les histogrammes (dépenses par catégorie + budget alloué) et la variation
    # prévisionnelle sont scopés à une période : un mois précis (vue="mois",
    # par défaut le mois courant) ou l'année entière (vue="annee", mois
    # ignoré). Le solde projeté est borné à la fin de cette même période ; le
    # solde réel, lui, reste cumulatif (il ne compte que du déjà-survenu).
    if vue not in ("mois", "annee", "tout"):
        raise HTTPException(
            status_code=400, detail="vue doit être 'mois', 'annee' ou 'tout'"
        )

    aujourdhui = date.today()
    annee = annee if annee is not None else aujourdhui.year
    # « TOUT » EST LA SOMME DES VUES ANNUELLES (cf. services/periode_tout) : les
    # agrégats sont ceux de `ToutesLesAnnees`, qui ont les noms de `soldes`, et le
    # reste de cette route ne distingue pas les deux. Les soldes se projettent
    # jusqu'à la fin de la dernière année couverte, comme la vue annuelle le fait
    # pour la sienne.
    agregats = soldes
    fin_projection = None
    if vue == "tout":
        annees = periode_tout.annees_couvertes(db, aujourdhui)
        agregats = periode_tout.ToutesLesAnnees(annees)
        fin_projection = date(annees[-1], 12, 31)
        mois = None
    elif vue == "annee":
        mois = None
    else:
        mois = mois if mois is not None else aujourdhui.month
        if mois < 1 or mois > 12:
            raise HTTPException(status_code=400, detail="mois doit être entre 1 et 12")

    # Topping-up paresseux des occurrences récurrentes (cf.
    # crud.generer_occurrences_recurrentes) : le dashboard lit directement la
    # table Operation, il doit rester à jour même sans être passé par
    # GET /operations auparavant.
    crud.generer_occurrences_recurrentes(db)

    comptes_soldes = soldes.get_soldes_comptes(
        db, date_fin=fin_projection or soldes.fin_de_periode(annee, mois)
    )
    comptes_read = [
        schemas.CompteSoldeRead(
            id=item["compte"].id,
            nom=item["compte"].nom,
            type_nom=item["compte"].type_nom,
            soldes=[
                schemas.SoldeMonnaieRead(
                    monnaie_id=monnaie_id,
                    monnaie_nom=solde["monnaie"].nom,
                    monnaie_symbole=solde["monnaie"].symbole,
                    solde_initial=solde["solde_initial"],
                    solde_reel=solde["solde_reel"],
                    solde_projete=solde["solde_projete"],
                )
                for monnaie_id, solde in item["soldes"].items()
            ],
        )
        for item in comptes_soldes
    ]
    totaux = soldes.calculer_totaux_par_monnaie(
        comptes_soldes, valorisation_placements=placements.valorisation_totale(db)
    )

    # Un onglet par monnaie effectivement portée par un compte : les monnaies
    # créées mais jamais utilisées n'encombrent pas le dashboard. L'ordre est
    # celui de la table `monnaie`, pas celui des comptes, pour que les onglets
    # ne se réorganisent pas au gré des renommages de comptes.
    monnaies_utilisees = {
        monnaie_id for item in comptes_soldes for monnaie_id in item["soldes"]
    } | set(totaux)
    monnaies = [m for m in crud.get_monnaies(db) if m.id in monnaies_utilisees]

    # UN SEUL CALCUL POUR TOUTES LES MONNAIES, et hors de la boucle : c'est un
    # STOCK, sans période, donc rien dans les paramètres de l'écran ne le fait
    # varier (cf. services/soldes.get_reste_a_rembourser).
    reste_a_rembourser = soldes.get_reste_a_rembourser(db)

    kpis = []
    for monnaie in monnaies:
        totaux_monnaie = totaux.get(monnaie.id, {})
        reste = reste_a_rembourser.get(monnaie.id, {})
        # Un seul appel pour les trois flux : les recalculer séparément
        # ouvrirait la porte à une variation qui ne vaut pas entrées − sorties.
        flux = agregats.get_flux_periode(db, annee, mois, monnaie.id)
        # Le détail des deux cartes, au MÊME périmètre que leur total : c'est
        # ce qui garantit que les trois lignes de l'infobulle additionnent bien
        # une part du chiffre qu'elles expliquent (cf. get_top_flux_periode).
        top_flux = agregats.get_top_flux_periode(db, annee, mois, monnaie.id)
        kpis.append(
            schemas.KpisMonnaieRead(
                monnaie_id=monnaie.id,
                monnaie_nom=monnaie.nom,
                monnaie_symbole=monnaie.symbole,
                solde_total_courant=totaux_monnaie.get("solde_total_courant", 0.0),
                solde_projete_courant=totaux_monnaie.get("solde_projete_courant", 0.0),
                total_avoirs=totaux_monnaie.get("total_avoirs", 0.0),
                valorisation_placements=totaux_monnaie.get("valorisation_placements", 0.0),
                total_entrees=flux["entrees"],
                total_sorties=flux["sorties"],
                top_entrees=[schemas.DepenseTopRead(**d) for d in top_flux["entrees"]],
                top_sorties=[schemas.DepenseTopRead(**d) for d in top_flux["sorties"]],
                reste_a_recevoir=reste.get("a_recevoir", 0.0),
                reste_a_rendre=reste.get("a_rendre", 0.0),
                reste_a_rembourser=reste.get("net", 0.0),
                variation_previsionnelle=flux["variation"],
                variation_brute=agregats.get_variation_brute(
                    db, annee, mois, monnaie.id
                ),
                budget_total=agregats.get_budget_total_periode(db, annee, mois, monnaie.id),
                # Sur l'année (mois=None) il n'y a pas UN budget à qualifier :
                # le champ est fermé de toute façon, et « hérité » n'y voudrait
                # rien dire.
                budget_total_explicite=(
                    crud.budget_total_est_explicite(db, annee, mois, monnaie.id)
                    if mois is not None
                    else True
                ),
                depenses_par_categorie=[
                    schemas.DepenseParCategorie(**item)
                    for item in agregats.get_depenses_par_categorie(db, annee, mois, monnaie.id)
                ],
            )
        )

    return schemas.DashboardRead(
        comptes=comptes_read,
        monnaies=[schemas.MonnaieRead.model_validate(m) for m in monnaies],
        kpis=kpis,
    )
