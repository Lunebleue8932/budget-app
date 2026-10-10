from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, object_session

from app import crud, schemas
from app.constants import AXES_EXPOSITION, AxeTitre
from app.database import get_db
from app.services import exposition, identite_titre, placements

router = APIRouter(prefix="/titres", tags=["placements"])


def _avertissements(titre) -> list[str]:
    """Ce qui est incomplet sans être faux : une répartition qui ne couvre pas 100 %,
    une couverture qui ne colle pas aux poids du dictionnaire, une composition
    ancienne. Calculé à la lecture : ça ne s'écrit jamais, et ça ne peut donc pas
    périmer."""
    messages = []
    for axe in AXES_EXPOSITION:
        lignes = titre.repartition(axe.value)
        if lignes:
            try:
                messages += [
                    f"{axe.value} : {m}"
                    for m in exposition.valider_repartition(
                        [(e.type_titre_id, e.poids_pct) for e in lignes]
                    )
                ]
            except exposition.ErreurExposition as erreur:
                # Une donnée déjà en base qui ne tient pas (écrite à la main, ou par
                # une version plus récente) : on la dit, on ne fait pas tomber la lecture.
                messages.append(f"{axe.value} : {erreur}")
    if titre.composition:
        try:
            messages += exposition.valider_composition(
                titre.composition, titre.composition_couverture_pct
            )
        except exposition.ErreurExposition as erreur:
            messages.append(f"composition : {erreur}")
    return messages


def _titre_read(titre, detenus: set[int] | None = None) -> schemas.TitreRead:
    """`detenus` : les titres détenus aujourd'hui, calculés UNE fois par la liste ; à défaut
    (un seul titre relu après une modification), sa quantité est recomptée ici."""
    db = object_session(titre)
    detenu = (
        titre.id in detenus
        if detenus is not None
        else placements.quantite_detenue_totale(db, titre.id) > placements.EPSILON_QUANTITE
    )
    return schemas.TitreRead(
        id=titre.id,
        # Les trois dénominations, et elles ne servent pas à la même chose :
        # `nom` identifie (c'est lui que l'import rapproche), `nom_affiche` se
        # lit, `code_isin` identifie mieux encore quand le fichier le porte.
        nom=titre.nom,
        supprimable=(
            not crud.titre_est_utilise(object_session(titre), titre.id)
            and not crud.etf_qui_citent(object_session(titre), titre)
        ),
        cite_par=[etf.nom_affiche for etf in crud.etf_qui_citent(object_session(titre), titre)],
        nom_affichage=titre.nom_affichage,
        nom_affiche=titre.nom_affiche,
        valeur=titre.valeur,
        monnaie_id=titre.monnaie_id,
        monnaie_symbole=titre.monnaie.symbole,
        archivee=titre.archivee,
        detenu=detenu,
        code_isin=titre.code_isin,
        # Le libellé voyage à côté de l'identifiant : les tableaux l'affichent
        # tel quel, sans avoir à recharger la liste des types pour le résoudre.
        type_titre_id=titre.type_titre_id,
        type_titre_nom=titre.type_titre.nom if titre.type_titre else None,
        classe_actif_id=titre.classe_actif_id,
        classe_actif_nom=titre.classe_actif.nom if titre.classe_actif else None,
        expositions=[
            schemas.ExpositionLigneRead(
                axe=e.axe,
                type_titre_id=e.type_titre_id,
                type_titre_nom=e.etiquette.nom,
                poids_pct=e.poids_pct,
                source=e.source,
                date_maj=e.date_maj,
            )
            for axe in AXES_EXPOSITION
            for e in titre.repartition(axe.value)
        ],
        composition=titre.composition or None,
        composition_couverture_pct=titre.composition_couverture_pct,
        avertissements=_avertissements(titre),
    )


def _quantite_lisible(quantite: float) -> str:
    """Une quantité de titres telle qu'on l'écrirait : « 12 » et non « 12.0 »,
    mais « 0,5 » quand la fraction compte (les ETF s'achètent en fractions)."""
    arrondie = round(quantite, 6)
    return str(int(arrondie)) if arrondie == int(arrondie) else f"{arrondie:g}"


def _valider_monnaie(db: Session, monnaie_id) -> None:
    if monnaie_id is not None and crud.get_monnaie(db, monnaie_id) is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")


def _valider_etiquette(db: Session, etiquette_id, axe: str) -> None:
    """0 est LE DÉTYPAGE, pas un identifiant : le menu envoie « aucun » sous
    cette forme, et il n'y a rien à aller chercher en base.

    L'AXE EST VÉRIFIÉ, et pas seulement l'existence : les étiquettes vivent toutes
    dans la même table (migrations 0066 et 0076), et rien n'empêcherait autrement
    de poser une classe d'actif à la place d'un secteur. Le camembert des secteurs
    aurait alors une part « Obligations » qui n'y a rien à faire."""
    if not etiquette_id:
        return
    etiquette = crud.get_type_titre(db, etiquette_id)
    if etiquette is None or etiquette.axe != axe:
        raise HTTPException(status_code=404, detail=_INTROUVABLE.get(axe, "Étiquette introuvable"))


_INTROUVABLE = {
    AxeTitre.enveloppe.value: "Type de titre introuvable",
    AxeTitre.classe.value: "Classe d'actif introuvable",
    AxeTitre.zone.value: "Zone géographique introuvable",
    AxeTitre.secteur.value: "Secteur introuvable",
}


def _valider_composition(payload) -> None:
    """Le dictionnaire d'un ETF, validé par le module que partage l'import : un ISIN
    bien formé, des poids dans ]0 ; 100], une somme qui ne dépasse pas 100. Les
    écarts de couverture, eux, sont des AVERTISSEMENTS de lecture, pas des refus."""
    if not payload.composition:
        return
    try:
        exposition.valider_composition(payload.composition, payload.composition_couverture_pct or None)
    except exposition.ErreurExposition as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None


@router.get("", response_model=list[schemas.TitreRead])
def list_titres(inclure_archivees: bool = False, db: Session = Depends(get_db)):
    """Les titres en service. `inclure_archivees=true` rend aussi ceux qu'on a
    rangés — l'écran s'en sert pour la case « Afficher les titres archivés »,
    qui est le seul endroit d'où l'on peut en remettre un en service."""
    detenus = placements.titres_detenus(db)
    return [
        _titre_read(titre, detenus)
        for titre in crud.get_titres(db, inclure_archivees=inclure_archivees)
    ]


@router.post("", response_model=schemas.TitreRead, status_code=status.HTTP_201_CREATED)
def create_titre(payload: schemas.TitreCreate, db: Session = Depends(get_db)):
    # LE COUPLE (NOM, ISIN) IDENTIFIE (cf. services/identite_titre.py) : un homonyme sous un
    # autre ISIN est un autre titre, et se crée.
    conflit = identite_titre.conflit_identite(db, payload.nom, payload.code_isin)
    if conflit:
        raise HTTPException(status_code=409, detail=conflit)
    _valider_monnaie(db, payload.monnaie_id)
    _valider_etiquette(db, payload.type_titre_id, AxeTitre.enveloppe.value)
    _valider_etiquette(db, payload.classe_actif_id, AxeTitre.classe.value)
    # L'ISIN VOYAGEAIT SANS ÊTRE ÉCRIT : le schéma l'acceptait, la création ne le
    # posait pas. Un titre saisi ici perdait donc son code, et l'import suivant,
    # qui rapproche par l'ISIN avant le nom, en créait un second.
    return _titre_read(
        crud.create_titre(
            db,
            payload.nom,
            payload.monnaie_id,
            payload.valeur,
            payload.code_isin,
            payload.type_titre_id,
            payload.classe_actif_id,
        )
    )


@router.put("/{titre_id}", response_model=schemas.TitreRead)
def update_titre(titre_id: int, payload: schemas.TitreUpdate, db: Session = Depends(get_db)):
    """Renommer, et surtout mettre à jour le cours : l'app n'a aucune source de
    marché, cette valeur est saisie à la main et ne sert qu'à valoriser les
    portefeuilles à l'écran — jamais à recalculer un solde en espèces, qui ne
    dépend que des prix réellement payés.

    DEUX NOMS, ET UN SEUL SE RENOMME DEPUIS L'ÉCRAN. `nom_affichage` est ce
    qu'on lit ; `nom` est ce que le courtier écrit, et c'est par lui — à défaut
    d'ISIN — que l'import RECONNAÎT le titre d'un fichier à l'autre. Le second
    reste modifiable par cette route (rien ne l'interdit), mais l'écran ne le
    propose pas : le changer ferait que l'import suivant ne retrouverait plus le
    titre et scinderait la position en deux."""
    titre = crud.get_titre(db, titre_id)
    if titre is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    nom_vise = payload.nom if payload.nom is not None else titre.nom
    isin_vise = payload.code_isin if payload.code_isin is not None else titre.code_isin
    if (nom_vise, isin_vise) != (titre.nom, titre.code_isin):
        conflit = identite_titre.conflit_identite(db, nom_vise, isin_vise, sauf_id=titre.id)
        if conflit:
            raise HTTPException(status_code=409, detail=conflit)
    _valider_monnaie(db, payload.monnaie_id)
    _valider_etiquette(db, payload.type_titre_id, AxeTitre.enveloppe.value)
    _valider_etiquette(db, payload.classe_actif_id, AxeTitre.classe.value)
    _valider_composition(payload)
    # Changer la monnaie de cotation d'un titre déjà mouvementé réécrirait le
    # sens de mouvements passés (le prix payé était libellé dans l'ancienne) :
    # les écritures d'espèces existantes, elles, ne bougeraient pas.
    if (
        payload.monnaie_id is not None
        and payload.monnaie_id != titre.monnaie_id
        and crud.titre_est_utilise(db, titre_id)
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Ce titre a des mouvements enregistrés : sa monnaie de cotation "
                "ne peut plus changer (les montants déjà payés sont libellés dans "
                "l'ancienne)."
            ),
        )
    # ARCHIVER UN TITRE QU'ON DÉTIENT ENCORE n'a pas de sens : il sortirait des
    # menus tout en continuant de peser dans la valorisation du portefeuille,
    # sans plus aucun moyen de le vendre depuis l'écran. Le désarchivage, lui,
    # ne se refuse jamais.
    if payload.archivee and not titre.archivee:
        quantite = placements.quantite_detenue_totale(db, titre_id)
        if quantite > placements.EPSILON_QUANTITE:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"« {titre.nom_affiche} » est encore détenu ({_quantite_lisible(quantite)} "
                    "titre(s)) : vends la position avant de l'archiver."
                ),
            )
    return _titre_read(
        crud.update_titre(
            db,
            titre,
            nom=payload.nom,
            nom_affichage=payload.nom_affichage,
            valeur=payload.valeur,
            monnaie_id=payload.monnaie_id,
            archivee=payload.archivee,
            type_titre_id=payload.type_titre_id,
            classe_actif_id=payload.classe_actif_id,
            composition=payload.composition,
            composition_couverture_pct=payload.composition_couverture_pct,
        )
    )


@router.put("/{titre_id}/expositions", response_model=schemas.TitreRead)
def remplacer_expositions(
    titre_id: int, payload: schemas.ExpositionsUpdate, db: Session = Depends(get_db)
):
    """REMPLACE la répartition d'un titre sur UN axe (classe, zone ou secteur).

    UN REMPLACEMENT D'UN BLOC, pas une ligne à la fois : une répartition est un
    instantané qu'on corrige entier, et ajouter ligne à ligne laisserait exister,
    entre deux appels, une répartition qui ne somme pas ce qu'elle devrait. Liste
    vide : l'axe est vidé, tout redevient « non renseigné ».

    VALIDÉE PAR `services/exposition`, le même module que l'import de titres : un
    poids hors de ]0 ; 100], la même étiquette deux fois, une somme au-dessus de 100
    sont refusés (422). Une somme EN DESSOUS n'est pas une faute : elle se lit en
    avertissement sur le titre, et RIEN N'EST RENORMALISÉ."""
    titre = crud.get_titre(db, titre_id)
    if titre is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    axe = payload.axe
    if axe not in AXES_EXPOSITION:
        raise HTTPException(
            status_code=422, detail="L'enveloppe n'est pas une répartition : elle se pose sur le titre"
        )
    for ligne in payload.lignes:
        _valider_etiquette(db, ligne.type_titre_id, axe.value)
    try:
        exposition.valider_repartition([(l.type_titre_id, l.poids_pct) for l in payload.lignes])
    except exposition.ErreurExposition as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None
    crud.poser_repartition(
        db,
        titre,
        axe.value,
        [(l.type_titre_id, l.poids_pct) for l in payload.lignes],
        source=payload.source,
        date_maj=payload.date_maj,
    )
    db.commit()
    db.refresh(titre)
    return _titre_read(titre)


@router.delete("/{titre_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_titre(titre_id: int, db: Session = Depends(get_db)):
    titre = crud.get_titre(db, titre_id)
    if titre is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    # UN TITRE MOUVEMENTÉ NE SE SUPPRIME PAS, et ce n'est pas une limitation
    # qu'on lèvera : chacun de ses mouvements porte une opération d'espèces
    # réelle (cf. models.OperationTitre), et les effacer réécrirait le solde du
    # compte-titres et tout ce qui en découle.
    #
    # Le message DIT LA SORTIE. Il envoyait auparavant supprimer les mouvements
    # un à un — c'est-à-dire détruire l'historique de ce qu'on a réellement
    # acheté et vendu, pour le seul confort de ne plus voir une ligne. Ranger le
    # titre donne le même résultat à l'écran sans rien perdre.
    if crud.titre_est_utilise(db, titre_id):
        raise HTTPException(
            status_code=409,
            detail=(
                f"« {titre.nom_affiche} » a des mouvements enregistrés : il ne peut pas être "
                "supprimé sans réécrire les soldes du compte. Archive-le plutôt — il "
                "quitte les listes, son historique et ses plus-values restent."
            ),
        )
    # NI UN TITRE QU'UN ETF CITE : sa composition le lit pour éclater l'ETF dans les graphes
    # (exposition par action), et l'effacer y laisserait un ISIN sans nom.
    citants = crud.etf_qui_citent(db, titre)
    if citants:
        raise HTTPException(
            status_code=409,
            detail=(
                f"« {titre.nom_affiche} » figure dans la composition de "
                f"{', '.join(f'« {etf.nom_affiche} »' for etf in citants)} : retire-le de cette "
                "composition avant de le supprimer."
            ),
        )
    crud.delete_titre(db, titre)
