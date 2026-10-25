from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, object_session

from app import crud, schemas
from app.constants import AXES_EXPOSITION, AxeTitre
from app.database import get_db
from app.services import calque_fonds, exposition, identite_titre, placements

import service_nettoyage_titres as service_nettoyage

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


def _titre_read(
    titre, detenus: set[int] | None = None, cites: dict | None = None
) -> schemas.TitreRead:
    """`detenus` : les titres détenus aujourd'hui, calculés UNE fois par la liste ; à défaut
    (un seul titre relu après une modification), sa quantité est recomptée ici. `cites` : de même,
    les ETF qui citent chaque titre (cf. crud.etf_qui_citent_tous)."""
    db = object_session(titre)
    etf_citant = cites.get(titre.id, []) if cites is not None else crud.etf_qui_citent(db, titre)
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
        supprimable=not crud.titre_est_utilise(db, titre.id) and not etf_citant,
        cite_par=[etf.nom_affiche for etf in etf_citant],
        nom_affichage=titre.nom_affichage,
        nom_affiche=titre.nom_affiche,
        valeur=titre.valeur,
        monnaie_id=titre.monnaie_id,
        monnaie_symbole=titre.monnaie.symbole,
        archivee=titre.archivee,
        detenu=detenu,
        part_etf=bool(titre.part_etf),
        est_indice=bool(titre.est_indice),
        indice_id=titre.indice_id,
        indice_nom=titre.indice.nom_affiche if titre.indice else None,
        calque_proprietes=list(titre.calque_proprietes or []),
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
    cites = crud.etf_qui_citent_tous(db)
    return [
        _titre_read(titre, detenus, cites)
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
    if payload.est_indice and payload.type_titre_id:
        raise HTTPException(status_code=422, detail="Un indice n'a pas d'enveloppe")
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
            est_indice=payload.est_indice,
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
    # UN INDICE N'A PAS D'ENVELOPPE : on ne lui en pose pas (le détypage, lui, reste permis).
    if (titre.est_indice or payload.est_indice) and payload.est_indice is not False and payload.type_titre_id:
        raise HTTPException(status_code=422, detail="Un indice n'a pas d'enveloppe")
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
    # UN INDICE NE SE DÉTIENT PAS : on ne transforme pas ce qu'on possède, ni ce qui a déjà porté des
    # mouvements (leur historique deviendrait celui d'un titre qui ne peut pas exister).
    if payload.est_indice and not titre.est_indice:
        if placements.quantite_detenue_totale(db, titre_id) > placements.EPSILON_QUANTITE:
            raise HTTPException(
                status_code=409,
                detail=f"« {titre.nom_affiche} » est détenu : un indice ne peut pas l'être.",
            )
        if crud.titre_est_utilise(db, titre_id):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"« {titre.nom_affiche} » a des mouvements enregistrés : il ne peut pas devenir "
                    "un indice."
                ),
            )
    mis_a_jour = crud.update_titre(
        db,
        titre,
        est_indice=payload.est_indice,
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
    # L'indice vient de changer de composition : les ETF calqués dessus la reprennent.
    if mis_a_jour.est_indice and payload.composition is not None:
        calque_fonds.propager(db, mis_a_jour)
        db.commit()
    return _titre_read(mis_a_jour)


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
    lignes = [(l.type_titre_id, l.poids_pct) for l in payload.lignes]
    try:
        # UNE ACTION EN DIRECT EST VERROUILLÉE : une étiquette, 100 % (cf. services/exposition).
        if exposition.est_action_en_direct(titre.type_titre.nom if titre.type_titre else None):
            lignes = exposition.verrouiller_action_en_direct(lignes)
        exposition.valider_repartition(lignes)
    except exposition.ErreurExposition as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None
    crud.poser_repartition(
        db,
        titre,
        axe.value,
        lignes,
        source=payload.source,
        date_maj=payload.date_maj,
    )
    if titre.est_indice:
        calque_fonds.propager(db, titre)
    db.commit()
    db.refresh(titre)
    return _titre_read(titre)


@router.get("/nettoyage")
def proposer_nettoyage(db: Session = Depends(get_db)):
    """Les GROUPES de titres qui se ressemblent et pourraient n'en faire qu'un (cf. service_nettoyage_titres) :
    du plus sûr au moins sûr. Ne modifie rien."""
    return service_nettoyage.proposer(db)


@router.post("/nettoyage/fusionner")
def fusionner_titres(payload: dict, db: Session = Depends(get_db)):
    """Fusionne des titres dans l'un d'eux : `{garder_id, absorber_ids}`. Tout ou rien."""
    try:
        return service_nettoyage.fusionner(
            db, int(payload.get("garder_id") or 0), [int(i) for i in payload.get("absorber_ids") or []]
        )
    except service_nettoyage.ErreurFusion as erreur:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(erreur)) from None


@router.get("/{titre_id}/donnees")
def donnees_du_titre(titre_id: int, db: Session = Depends(get_db)):
    """Ce que le titre porte (composition, classe, zone, secteur), résumé : l'écran le montre AVANT
    d'écraser quoi que ce soit (cf. services/calque_fonds)."""
    titre = crud.get_titre(db, titre_id)
    if titre is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    return calque_fonds.resume(titre)


@router.put("/{titre_id}/calque", response_model=schemas.TitreRead)
def calquer_sur_indice(titre_id: int, payload: schemas.CalqueTitre, db: Session = Depends(get_db)):
    """CALQUE un fonds sur un indice : les propriétés choisies de l'indice REMPLACENT celles du fonds,
    les autres restent. Le choix, propriété par propriété, est celui de l'utilisateur."""
    cible = crud.get_titre(db, titre_id)
    if cible is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    if cible.est_indice:
        raise HTTPException(status_code=409, detail="Un indice ne se calque pas sur un autre indice")
    if payload.indice_id is None:
        # Délier : l'ETF garde ses données, il ne suit plus l'indice.
        calque_fonds.delier(cible)
        db.commit()
        db.refresh(cible)
        return _titre_read(cible)
    indice = crud.get_titre(db, payload.indice_id)
    if indice is None or not indice.est_indice:
        raise HTTPException(status_code=404, detail="Indice introuvable")
    if not payload.proprietes:
        raise HTTPException(status_code=422, detail="Choisis au moins une propriété à prendre à l'indice")
    try:
        calque_fonds.calquer(db, cible, indice, payload.proprietes)
    except calque_fonds.ErreurCalque as erreur:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(erreur)) from None
    db.commit()
    db.refresh(cible)
    return _titre_read(cible)


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
