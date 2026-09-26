"""Le dashboard, tout entier ramené à UNE monnaie.

CE QUE CE MODULE FAIT, ET CE QU'IL NE REFAIT PAS. Il n'y a aucun calcul de solde
ici : le dashboard du noyau est appelé tel quel, avec ses KPI par monnaie, et
seule la dernière étape — l'addition entre monnaies, que le noyau se refuse à
faire — est ajoutée. C'est ce qui garantit que la vue convertie et les onglets
par monnaie racontent la même chose : ce sont les mêmes chiffres, additionnés
une fois de plus.

LA MÊME FORME EN SORTIE (`schemas.DashboardRead`), avec une seule monnaie et un
seul jeu de KPI. Le frontend rend donc la vue convertie avec les fonctions du
noyau, sans une ligne d'affichage en double.

CE QUI NE SE CONVERTIT PAS : le budget d'une catégorie. Un budget est posé pour
un mois ET une monnaie (cf. models.Categorie) ; convertir la limite en même
temps que la dépense donnerait un repère qui bouge au gré du taux, ce qui n'est
plus une limite. Le trait rouge de l'histogramme est donc la somme des budgets
convertis, et rien n'y est inventé — mais il faut savoir qu'il flotte, et
l'écran le dit.
"""
from app import schemas
from app.routers import dashboard as dashboard_noyau

import service_conversion


# Combien de lignes garde l'infobulle d'un total, de chaque côté. Repris du
# noyau (soldes.NB_TOP_DEPENSES) : la bulle convertie et la bulle d'une monnaie
# doivent montrer le même nombre de lignes.
NB_TOP = 3


def _fondre_top(accumulateur: dict, lignes, coefficient: float) -> None:
    """Fond les plus grosses lignes d'une monnaie dans celles déjà rencontrées.

    LA CLÉ EST LE LIBELLÉ, comme partout où l'application fond des lignes (cf.
    soldes._fondre_par_libelle) : un « Loyer » payé en euros et un « Loyer »
    payé en francs sont le même loyer, et c'est justement ce que la conversion
    permet enfin de dire.

    CE QUE CELA CORRIGE. Les deux cartes « Total Entrées » et « Total Dépenses »
    portent une infobulle qui dit d'où vient leur total ; le KPI agrégé ne la
    remplissait pas, et elle annonçait donc « Aucune opération sur la période »
    À CHAQUE FOIS que la case « Tout convertir » était cochée — sur un mois où
    l'on venait justement de lire le total juste au-dessus."""
    for ligne in lignes:
        libelle = (ligne.nature or "").strip()
        entree = accumulateur.setdefault(libelle, {"montant": 0.0, "nombre": 0})
        entree["montant"] += ligne.montant * coefficient
        entree["nombre"] += ligne.nombre


def _classer_top(accumulateur: dict) -> list:
    """Les plus grosses, du plus lourd au plus léger — le libellé départageant
    deux montants égaux, pour que deux lectures donnent le même ordre.

    ON RECLASSE, ON NE CONCATÈNE PAS : deux listes déjà triées mises bout à bout
    ne le sont plus, et les trois premières d'une liste de six seraient alors
    les trois premières d'UNE monnaie."""
    return [
        schemas.DepenseTopRead(nature=libelle, montant=valeurs["montant"], nombre=valeurs["nombre"])
        for libelle, valeurs in sorted(
            accumulateur.items(), key=lambda paire: (-paire[1]["montant"], paire[0])
        )
    ][:NB_TOP]


def _categorie_agregee(accumulateur: dict, depense, coefficient: float) -> None:
    """Fond une ligne de catégorie dans son homologue déjà rencontrée.

    LA CLÉ EST LE NOM DE LA CATÉGORIE. Le dashboard rend une liste par monnaie,
    et une même catégorie y apparaît une fois par monnaie où elle a servi :
    « Courses » en euros et « Courses » en dollars sont la même catégorie, et
    c'est justement ce que la conversion permet enfin de dire.
    """
    ligne = accumulateur.setdefault(
        depense.categorie,
        {
            "categorie": depense.categorie,
            "total_reel": 0.0,
            "total_previsionnel": 0.0,
            "budget_alloue": 0.0,
            "top_depenses": [],
            "couleur_index": depense.couleur_index,
            # PAS DE COEFFICIENT SUR UN POURCENTAGE : l'objectif est une part,
            # pas un montant, et convertir une part n'a aucun sens. La même
            # catégorie vue dans deux monnaies porte forcément le même objectif
            # (il est posé sur la catégorie, cf. models.Categorie), c'est donc
            # celui de la première ligne rencontrée — et l'oublier aurait fait
            # disparaître toutes les pastilles d'objectif dès que la case
            # « Tout convertir » est cochée.
            "objectif_pourcentage": depense.objectif_pourcentage,
        },
    )
    ligne["total_reel"] += depense.total_reel * coefficient
    ligne["total_previsionnel"] += depense.total_previsionnel * coefficient
    ligne["budget_alloue"] += depense.budget_alloue * coefficient
    ligne["top_depenses"].extend(
        schemas.DepenseTopRead(
            nature=top.nature,
            montant=top.montant * coefficient,
            nombre=top.nombre,
        )
        for top in depense.top_depenses
    )


def dashboard_agrege(db, annee, mois, vue: str, vers_monnaie_id: int):
    """Le dashboard converti dans `vers_monnaie_id`.

    Rend (payload, monnaies non converties, composition du budget). La seconde
    valeur n'est pas un détail : une monnaie sans taux est ÉCARTÉE du total, et
    un total amputé sans le dire vaudrait moins qu'un refus.

    LA TROISIÈME DIT D'OÙ VIENT LE BUDGET, et elle existe parce que ce
    chiffre-là est le plus facile à ne pas reconnaître. Il subit DEUX
    multiplications invisibles : la vue année somme douze mois (cf.
    soldes.get_budget_total_periode) et l'agrégation convertit puis additionne
    les monnaies. Un budget de 500 $ posé une fois, jamais retouché, hérité par
    tous les mois de toutes les années (cf. crud._budget_herite) pèse ainsi
    5 400 € de plus sur un budget annuel dont l'utilisateur ne compte que les
    euros. Le chiffre est juste ; sans sa composition, rien ne permet de le
    reconnaître pour tel.
    """
    brut = dashboard_noyau.get_dashboard(annee=annee, mois=mois, vue=vue, db=db)
    coefficients, manquantes = service_conversion.table_de_conversion(db, vers_monnaie_id)

    cible = next((m for m in brut.monnaies if m.id == vers_monnaie_id), None)
    if cible is None:
        # La monnaie visée n'est portée par aucun compte : il n'y a rien à
        # convertir VERS elle, et l'appelant doit le savoir plutôt que de
        # recevoir un dashboard vide qui aurait l'air normal.
        return None, manquantes, []

    # ---------- Les KPI, additionnés une fois de plus ----------
    agrege = schemas.KpisMonnaieRead(
        monnaie_id=cible.id,
        monnaie_nom=cible.nom,
        monnaie_symbole=cible.symbole,
        solde_total_courant=0.0,
        solde_projete_courant=0.0,
        total_avoirs=0.0,
    )
    categories: dict = {}
    budget_detail: list[dict] = []
    top_entrees: dict = {}
    top_sorties: dict = {}
    for kpi in brut.kpis:
        coefficient = coefficients.get(kpi.monnaie_id)
        if coefficient is None:
            continue  # monnaie sans taux : écartée, et nommée dans `manquantes`
        # SEULES LES MONNAIES QUI APPORTENT QUELQUE CHOSE sont nommées : une
        # ligne à 0,00 € par devise inutilisée ferait de la composition un
        # tableau à lire plutôt qu'une réponse à lire.
        if kpi.budget_total:
            budget_detail.append(
                {
                    "monnaie_nom": kpi.monnaie_nom,
                    "montant": kpi.budget_total,
                    "converti": kpi.budget_total * coefficient,
                }
            )
        agrege.solde_total_courant += kpi.solde_total_courant * coefficient
        agrege.solde_projete_courant += kpi.solde_projete_courant * coefficient
        agrege.total_avoirs += kpi.total_avoirs * coefficient
        agrege.valorisation_placements += kpi.valorisation_placements * coefficient
        agrege.total_entrees += kpi.total_entrees * coefficient
        agrege.total_sorties += kpi.total_sorties * coefficient
        # LE DÉTAIL SUIT SON TOTAL, sans quoi les deux cartes se retrouvent avec
        # un chiffre et une infobulle qui annonce qu'il ne s'est rien passé.
        _fondre_top(top_entrees, kpi.top_entrees, coefficient)
        _fondre_top(top_sorties, kpi.top_sorties, coefficient)
        # La variation brute s'additionne comme les autres totaux : c'est une
        # somme de montants, pas une différence recalculée.
        agrege.variation_brute += kpi.variation_brute * coefficient
        # LE RESTE À REMBOURSER SE CONVERTIT COMME LE RESTE, bien qu'il ne
        # dépende d'aucune période : ce sont des montants, et une créance en
        # dollars converties en euros reste une créance. Les OUBLIER ici ne
        # ferait pas « rien » — la carte afficherait 0,00 € dès que la case
        # « Tout convertir » est cochée, ce qui est faux et silencieux.
        agrege.reste_a_recevoir += kpi.reste_a_recevoir * coefficient
        agrege.reste_a_rendre += kpi.reste_a_rendre * coefficient
        # LE BUDGET TOTAL SE CONVERTIT, LUI, parce que c'est un MONTANT : un
        # budget de 2 000 $ posé à côté d'un budget de 2 500 € fait bien 4 300 €
        # de droit de dépenser, et c'est ce chiffre-là que la vue « budget » du
        # camembert doit prendre pour dénominateur quand tout est converti.
        # L'oublier aurait fait disparaître la vue entière dès que la case est
        # cochée, faute de budget dans la monnaie d'arrivée.
        agrege.budget_total += kpi.budget_total * coefficient
        # UN SEUL BUDGET HÉRITÉ SUFFIT À RENDRE LE TOTAL HÉRITÉ : le champ du
        # camembert écrirait sinon un montant agrégé comme s'il avait été saisi
        # tel quel, alors qu'une partie vient d'un autre mois.
        agrege.budget_total_explicite = (
            agrege.budget_total_explicite and kpi.budget_total_explicite
        )
        for depense in kpi.depenses_par_categorie:
            _categorie_agregee(categories, depense, coefficient)

    # LA VARIATION N'EST PAS RECALCULÉE À PART. Elle vaut entrées − sorties, et
    # c'est cette garantie que le noyau tient en ne les produisant que d'un seul
    # calcul (cf. services/soldes.get_flux_periode) ; la convertir séparément
    # ouvrirait la porte à trois chiffres qui ne s'accordent plus à l'arrondi.
    agrege.variation_previsionnelle = agrege.total_entrees - agrege.total_sorties
    # Même raison pour le net des remboursements : il vaut ce qu'on me doit
    # moins ce que je dois, et le convertir à part le ferait diverger de ses
    # deux composantes à l'arrondi.
    agrege.reste_a_rembourser = agrege.reste_a_recevoir - agrege.reste_a_rendre
    agrege.top_entrees = _classer_top(top_entrees)
    agrege.top_sorties = _classer_top(top_sorties)

    for ligne in categories.values():
        # Les plus grosses dépenses de la catégorie, tous pays confondus, du
        # plus lourd au plus léger — comme le noyau les rend, mais reclassées :
        # deux listes déjà triées mises bout à bout ne le sont plus.
        ligne["top_depenses"].sort(key=lambda top: top.montant, reverse=True)
        ligne["top_depenses"] = ligne["top_depenses"][:3]
    agrege.depenses_par_categorie = [
        schemas.DepenseParCategorie(**ligne)
        for ligne in sorted(
            categories.values(), key=lambda ligne: ligne["total_previsionnel"], reverse=True
        )
    ]

    # ---------- Les comptes, un solde chacun ----------
    comptes = []
    for compte in brut.comptes:
        total_initial = total_reel = total_projete = 0.0
        for solde in compte.soldes:
            coefficient = coefficients.get(solde.monnaie_id)
            if coefficient is None:
                continue
            total_initial += solde.solde_initial * coefficient
            total_reel += solde.solde_reel * coefficient
            total_projete += solde.solde_projete * coefficient
        comptes.append(
            schemas.CompteSoldeRead(
                id=compte.id,
                nom=compte.nom,
                type_nom=compte.type_nom,
                soldes=[
                    schemas.SoldeMonnaieRead(
                        monnaie_id=cible.id,
                        monnaie_nom=cible.nom,
                        monnaie_symbole=cible.symbole,
                        solde_initial=total_initial,
                        solde_reel=total_reel,
                        solde_projete=total_projete,
                    )
                ],
            )
        )

    return (
        schemas.DashboardRead(comptes=comptes, monnaies=[cible], kpis=[agrege]),
        manquantes,
        budget_detail,
    )
