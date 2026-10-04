"""Les routes des objectifs, sous `/objectifs`.

LE PRÉFIXE n'est le paramètre d'aucune autre route et n'appartient à aucune
autre extension (cf. extensions/README.md).

CE QUE CES ROUTES ÉCRIVENT : la table `objectif_kpi`, et rien d'autre. Aucune
opération n'est créée, modifiée ni supprimée ici, aucun montant ne change — un
objectif REGARDE, il ne touche à rien.

UNE ROUTE DE LECTURE À PART (`/mesures`) : la liste des objectifs ne dépend
d'aucune période, leur mesure en dépend entièrement. Les fondre en une seule
route aurait obligé l'écran d'édition à nommer un mois pour afficher un
formulaire.
"""
from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import models
from app.constants import MesureObjectif
from app.database import get_db

import schemas_objectifs as schemas_obj
import service_objectifs as service

router = APIRouter(prefix="/objectifs", tags=["objectifs"])


def _objectif_ou_404(db: Session, objectif_id: int) -> models.ObjectifKpi:
    objectif = db.get(models.ObjectifKpi, objectif_id)
    if objectif is None:
        raise HTTPException(status_code=404, detail="Objectif introuvable")
    return objectif


def _valider_part(
    mesure: Optional[str],
    categorie_id: Optional[int],
    sous_filtre_id: Optional[int] = None,
    filtres: Optional[list] = None,
) -> None:
    """UNE PART SE MESURE SUR QUELQUE CHOSE, et c'est le seul refus de ce
    routeur.

    Sans périmètre, `part_depenses` rapporte TOUTES les dépenses au total des
    dépenses : elle vaut 100 % par construction, tous les mois, quoi qu'on
    dépense. Un objectif qui ne peut jamais bouger n'apprend rien et occupe une
    carte ; le refuser à la saisie coûte une phrase, le laisser passer coûte la
    confiance qu'on met dans les trois autres.

    UN PROJET FAIT UN PÉRIMÈTRE AUSSI BIEN QU'UNE CATÉGORIE : « mes vacances
    pèsent 12 % de ce que j'ai dépensé ce mois-ci » est exactement la question
    qu'on se pose devant un projet en cours.

    UN FILTRE AUSSI (migration 0073) : « mes dépenses du week-end pèsent 40 % »
    se mesure sur toutes les catégories, et ne vaut pas 100 % par construction —
    le dénominateur, lui, n'est pas filtré (cf. service_objectifs)."""
    if mesure == MesureObjectif.part_depenses.value and not (
        categorie_id or sous_filtre_id or filtres
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Une part des dépenses se mesure sur une catégorie ou un projet : "
                "sans périmètre, elle vaudrait toujours 100 %."
            ),
        )


def _valider_perimetre(
    db: Session,
    monnaie_id: Optional[int],
    categorie_id: Optional[int],
    sous_filtre_id: Optional[int] = None,
) -> None:
    """Un objectif désigne toujours quelque chose qui existe.

    LA CATÉGORIE ÉTEINTE EST ADMISE, contrairement à une opération qu'on
    saisirait (cf. crud.erreur_categorie_eteinte) : un objectif ne CRÉE rien, il
    relit l'historique — et c'est justement sur une catégorie dont on ne se sert
    plus qu'on peut vouloir vérifier qu'on a bien arrêté.

    UN SEUL PÉRIMÈTRE À LA FOIS (cf. models.ObjectifKpi) : une catégorie classe
    par nature, un projet regroupe par événement, et les deux se croisent —
    l'hôtel d'un voyage est dans « Loisirs » ET dans « Italie ». Porter les deux
    poserait une question dont aucune réponse ne s'impose."""
    if monnaie_id is not None and db.get(models.Monnaie, monnaie_id) is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    if categorie_id is not None and db.get(models.Categorie, categorie_id) is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    if sous_filtre_id is not None and db.get(models.SousFiltre, sous_filtre_id) is None:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    if categorie_id and sous_filtre_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "Un objectif vise une catégorie OU un projet, jamais les deux : "
                "ils découpent les mêmes dépenses selon deux axes différents."
            ),
        )


# ---------- Les objectifs eux-mêmes ----------


@router.get("", response_model=list[schemas_obj.ObjectifRead])
def lister_objectifs(
    monnaie_id: Optional[int] = None, db: Session = Depends(get_db)
):
    """Tous les objectifs, ou ceux d'une monnaie.

    TOUS PAR DÉFAUT, parce que l'écran d'édition les montre tous : c'est là
    qu'on vient voir ce qu'on s'est fixé, et un filtre de monnaie posé d'office
    y aurait caché ce qu'on cherche sans le dire."""
    requete = db.query(models.ObjectifKpi)
    if monnaie_id is not None:
        requete = requete.filter(models.ObjectifKpi.monnaie_id == monnaie_id)
    return requete.order_by(models.ObjectifKpi.ordre, models.ObjectifKpi.id).all()


@router.post("", response_model=schemas_obj.ObjectifRead, status_code=201)
def creer_objectif(payload: schemas_obj.ObjectifCreate, db: Session = Depends(get_db)):
    _valider_perimetre(
        db, payload.monnaie_id, payload.categorie_id, payload.sous_filtre_id
    )
    _valider_part(
        payload.mesure.value, payload.categorie_id, payload.sous_filtre_id, payload.filtres
    )
    # UN OBJECTIF NEUF VA EN FIN DE LISTE. Le défaut du schéma est zéro, qui
    # l'aurait glissé au MILIEU des objectifs déjà là : on le cherche alors dans
    # une liste où il n'est pas au bout, et le geste suivant — le relire pour
    # vérifier ce qu'on vient d'écrire — devient une chasse.
    ordre = payload.ordre
    if not ordre:
        dernier = (
            db.query(models.ObjectifKpi.ordre)
            .order_by(models.ObjectifKpi.ordre.desc())
            .first()
        )
        ordre = (dernier[0] + 1) if dernier else 0
    objectif = models.ObjectifKpi(
        nom=payload.nom.strip(),
        mesure=payload.mesure.value,
        cadence=payload.cadence.value,
        sens=payload.sens.value,
        cible=payload.cible,
        categorie_id=payload.categorie_id,
        sous_filtre_id=payload.sous_filtre_id,
        monnaie_id=payload.monnaie_id,
        visible_dashboard=payload.visible_dashboard,
        ordre=ordre,
        filtres=[filtre.model_dump(mode="json") for filtre in payload.filtres],
    )
    db.add(objectif)
    db.commit()
    db.refresh(objectif)
    return objectif


@router.put("/{objectif_id}", response_model=schemas_obj.ObjectifRead)
def modifier_objectif(
    objectif_id: int,
    payload: schemas_obj.ObjectifUpdate,
    db: Session = Depends(get_db),
):
    objectif = _objectif_ou_404(db, objectif_id)
    _valider_perimetre(
        db,
        payload.monnaie_id,
        payload.categorie_id or None,
        payload.sous_filtre_id or None,
    )
    # La garde porte sur ce que l'objectif VAUDRA : changer la mesure sans
    # toucher au périmètre, ou retirer le périmètre sans toucher à la mesure,
    # mènent au même objectif impossible.
    _valider_part(
        payload.mesure.value if payload.mesure else objectif.mesure,
        objectif.categorie_id if payload.categorie_id is None else payload.categorie_id,
        objectif.sous_filtre_id
        if payload.sous_filtre_id is None
        else payload.sous_filtre_id,
        objectif.filtres if payload.filtres is None else payload.filtres,
    )

    for champ in ("nom", "cible", "visible_dashboard", "ordre", "monnaie_id"):
        valeur = getattr(payload, champ)
        if valeur is not None:
            setattr(objectif, champ, valeur.strip() if champ == "nom" else valeur)
    # RETIRER LA CIBLE EST UN GESTE À PART, et il fallait bien qu'il le soit :
    # `None` veut déjà dire « ne change pas » sur tous les autres champs, et
    # zéro est une cible à part entière (« aucune sortie ce mois-ci »).
    if payload.cible_effacee:
        objectif.cible = None
    for champ in ("mesure", "cadence", "sens"):
        valeur = getattr(payload, champ)
        if valeur is not None:
            setattr(objectif, champ, valeur.value)
    # ZÉRO ÉLARGIT À TOUTES LES DÉPENSES, `None` ne change rien : même
    # convention que le type d'un titre (cf. schemas_objectifs.ObjectifUpdate).
    #
    # ÉCRIRE UN PÉRIMÈTRE EFFACE L'AUTRE, et l'écran n'a donc rien à penser à
    # retirer : les deux s'excluent (cf. `_valider_perimetre`), et exiger qu'on
    # envoie le zéro de l'un en même temps que l'autre aurait fait de cette
    # exclusion un piège plutôt qu'une règle.
    if payload.categorie_id is not None:
        objectif.categorie_id = payload.categorie_id or None
        if objectif.categorie_id:
            objectif.sous_filtre_id = None
    if payload.sous_filtre_id is not None:
        objectif.sous_filtre_id = payload.sous_filtre_id or None
        if objectif.sous_filtre_id:
            objectif.categorie_id = None
    # UNE LISTE REMPLACE, `None` ne touche à rien ; une liste vide retire tout.
    # Réassignée en entier plutôt que modifiée sur place : SQLAlchemy ne voit
    # pas la mutation d'une liste JSON, seulement son remplacement.
    if payload.filtres is not None:
        objectif.filtres = [filtre.model_dump(mode="json") for filtre in payload.filtres]

    db.commit()
    db.refresh(objectif)
    return objectif


@router.delete("/{objectif_id}", status_code=204)
def supprimer_objectif(objectif_id: int, db: Session = Depends(get_db)):
    """SUPPRIMER UN OBJECTIF NE TOUCHE À AUCUNE OPÉRATION : rien ne le
    référence, et il ne référence rien qu'il emporte."""
    db.delete(_objectif_ou_404(db, objectif_id))
    db.commit()


# ---------- Ce qu'ils valent sur une période ----------


@router.get("/mesures", response_model=schemas_obj.ObjectifsPeriodeRead)
def mesurer_objectifs(
    monnaie_id: Optional[int] = None,
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    dashboard: bool = False,
    db: Session = Depends(get_db),
):
    """Les objectifs, mesurés sur la période demandée.

    `monnaie_id` ABSENT LES REND TOUS, chacun mesuré dans SA monnaie : c'est ce
    que demande la page des objectifs, qui les montre tous et n'additionne rien.
    Le DASHBOARD le nomme toujours — il a un onglet de monnaie, et on n'y
    additionne jamais deux devises.

    `mois` ABSENT VEUT DIRE L'ANNÉE ENTIÈRE, comme partout ailleurs (cf.
    soldes._filtre_periode) : c'est la vue annuelle du dashboard, et la cadence
    fait le reste — un objectif mensuel y vaut douze unités.

    `dashboard=true` ne rend que ceux qu'on a choisi d'y afficher : la page des
    objectifs les montre tous, le dashboard ceux qu'on suit vraiment."""
    if monnaie_id is not None and db.get(models.Monnaie, monnaie_id) is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    annee = annee if annee is not None else date_type.today().year
    return schemas_obj.ObjectifsPeriodeRead(
        annee=annee,
        mois=mois,
        monnaie_id=monnaie_id,
        objectifs=[
            schemas_obj.ObjectifMesureRead(**ligne)
            for ligne in service.mesurer_tous(
                db, annee, mois, monnaie_id, dashboard_seulement=dashboard
            )
        ],
    )


# ---------- Les opérations qui entrent en compte ----------


@router.get("/{objectif_id}/operations", response_model=schemas_obj.ObjectifOperationsRead)
def operations_de_l_objectif(
    objectif_id: int,
    vue: str = "actuelle",
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """La page d'un objectif : toutes les opérations qui entrent dans sa mesure.

    `vue` choisit l'une des deux lectures (« actuelle » ou « moyennee », cf.
    service_objectifs.fenetres_de_lecture), et `annee` / `mois` le niveau du
    dashboard d'où l'on vient — `mois` absent est la vue année. LES FENÊTRES SE
    RECALCULENT ICI plutôt que de voyager depuis l'écran : c'est le serveur qui sait
    ce qu'est « la semaine en cours » ou « tout l'historique », et un client qui
    enverrait des bornes pourrait demander une liste qui n'est celle d'aucune
    carte.

    LA SOMME DE `retenu` EST LA VALEUR DE LA CARTE (cf.
    service_objectifs.operations_contribuantes)."""
    if vue not in ("actuelle", "moyennee", "annee"):
        raise HTTPException(
            status_code=400, detail="Vue inconnue : « actuelle », « moyennee » ou « annee »"
        )
    objectif = _objectif_ou_404(db, objectif_id)
    annee = annee if annee is not None else date_type.today().year
    mesure = service.mesurer(db, objectif, annee, mois)
    fenetres = service.fenetres_de_lecture(db, objectif, annee, mois)
    # La vue « annee » n'existe que pour un objectif hebdomadaire lu depuis un mois :
    # un choix gardé d'un autre niveau retombe sur la moyennée, qui est alors l'année
    # (ou, à défaut, sur l'actuelle).
    if vue not in fenetres:
        vue = "moyennee"
    lignes = service.operations_contribuantes(db, objectif, fenetres[vue])
    return schemas_obj.ObjectifOperationsRead(
        mesure=schemas_obj.ObjectifMesureRead(**mesure),
        vue=vue,
        fenetre=schemas_obj.VueObjectifRead(**mesure[vue]),
        total_retenu=sum(ligne["retenu"] for ligne in lignes),
        operations=[schemas_obj.OperationObjectifRead(**ligne) for ligne in lignes],
    )
