"""Les routes de l'import de placements, sous `/import-placements`.

PRÉFIXE DISTINCT, MÊME FORME. Chaque route a son homologue exact sous
`/import` : preset, prévisualisation, confirmation, historique, annulation. Ce
n'est pas une coïncidence — c'est ce qui permet à l'écran de cette extension
d'être calqué sur celui de l'import bancaire sans avoir à raisonner autrement.

POURQUOI PAS LES ROUTES DU NOYAU. Elles ne servent QUE les presets bancaires
(cf. routers/import_bancaire._get_preset_ou_404, qui traite tout autre domaine
comme inexistant) : la validation des colonnes, la lecture des lignes et la
création des opérations y sont celles d'un relevé bancaire, et un preset de
placements qui y passerait produirait un résultat faux en silence. La frontière
est donc posée des deux côtés, et c'est le seul endroit où elle a besoin de
l'être.

CE QUI EST RÉUTILISÉ TEL QUEL : les validateurs du noyau (délimiteur,
séparateur décimal, colonnes, comparaison de doublons, vocabulaire), qui ne
dépendent pas du domaine, et la détection de doublons de virements — dont
l'extension n'a même pas de route à elle, l'écran appelle celle du noyau.
"""
from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.constants import (
    LIBELLES_TYPE_PLACEMENT_DEFAUT,
    PROPRIETES_IMPORT_PLACEMENT,
    PROPRIETES_IMPORT_PLACEMENT_IDENTITE,
    PROPRIETES_IMPORT_PLACEMENT_OBLIGATOIRES,
    PROPRIETES_IMPORT_POSITION,
    PROPRIETES_IMPORT_POSITION_OBLIGATOIRES,
    DomaineImport,
    ModeLecturePlacement,
)
from app.database import get_db
from app.routers import import_bancaire as routeur_bancaire
from app.services import import_bancaire, placements

import schemas_import_placements as schemas_pl
import service_import_placements as service

router = APIRouter(prefix="/import-placements", tags=["import-placements"])

DOMAINE = DomaineImport.placement.value


def _get_preset_ou_404(db: Session, preset_id: int) -> models.ImportPreset:
    """Le preset, à condition qu'il soit du domaine « placement ».

    Symétrique du garde du noyau, et pour la même raison : un preset bancaire
    passé ici verrait ses colonnes (« nature », « categorie_banque »…)
    silencieusement ignorées, et l'import créerait des lignes vides.
    """
    preset = crud.get_import_preset(db, preset_id)
    if preset is None or preset.domaine != DOMAINE:
        raise HTTPException(status_code=404, detail="Preset d'import introuvable")
    return preset


def _valider_compte_placement(db: Session, compte_id: Optional[int]) -> None:
    """Un preset d'import de placements ne peut viser qu'un COMPTE-TITRES.

    Refusé à l'enregistrement plutôt que découvert au premier import : lié à un
    compte courant, toutes ses lignes d'achat échoueraient une à une sans que
    l'écran puisse dire d'où vient le problème.
    """
    if compte_id is None:
        return
    compte = crud.get_compte(db, compte_id)
    if compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if not compte.est_placement:
        raise HTTPException(
            status_code=400,
            detail=(
                f"« {compte.nom} » n'est pas un compte de placements financiers : "
                "seul un compte-titres peut recevoir cet import."
            ),
        )


def _valider_identite_du_titre(proprietes: set[str]) -> None:
    """Comment une ligne désigne son titre : par le nom, par le code ISIN, ou
    par les deux — mais jamais par aucun des deux.

    Les deux sont facultatifs SÉPARÉMENT, ce qui est bien ce qu'on veut (un
    relevé qui ne porte que des ISIN est parfaitement importable, et l'inverse
    aussi). Les éteindre tous les deux laisserait en revanche chaque ligne
    d'achat sans aucun moyen de dire de quelle valeur elle parle : ce n'est pas
    une configuration incomplète, c'est une configuration qui ne peut rien
    importer. L'écran empêche déjà le geste ; ceci le garantit.
    """
    if not set(PROPRIETES_IMPORT_PLACEMENT_IDENTITE) & proprietes:
        raise HTTPException(
            status_code=400,
            detail=(
                "Un titre se reconnaît à son nom ou à son code ISIN : garde au "
                "moins l'une des deux colonnes. Sans elles, aucune ligne d'achat "
                "ou de vente ne peut dire de quelle valeur elle parle."
            ),
        )


def _mode_lecture(payload) -> ModeLecturePlacement:
    """Le mode déclaré par la configuration, `operations` à défaut — ce que sont
    tous les presets antérieurs à la migration 0046."""
    return payload.mode_lecture or ModeLecturePlacement.operations


def _valider_configuration(payload) -> None:
    """Les colonnes acceptées dépendent de CE QUE LE FICHIER RACONTE.

    Une liste d'opérations lit une date, un type, un montant ; une photographie
    de compte lit une quantité détenue et un prix de revient, et n'a ni date ni
    type. Croiser les deux jeux passerait des colonnes qui ne seront jamais lues
    — et donc une configuration qui a l'air complète et n'importe rien.

    Le contrôle « nom ou ISIN » vaut des deux côtés, et pour la même raison :
    sans l'un des deux, aucune ligne ne peut dire de quelle valeur elle parle.
    """
    position = _mode_lecture(payload) is ModeLecturePlacement.position
    proprietes = routeur_bancaire.valider_colonnes(
        payload.colonnes,
        PROPRIETES_IMPORT_POSITION if position else PROPRIETES_IMPORT_PLACEMENT,
        (
            PROPRIETES_IMPORT_POSITION_OBLIGATOIRES
            if position
            else PROPRIETES_IMPORT_PLACEMENT_OBLIGATOIRES
        ),
    )
    _valider_identite_du_titre(proprietes)
    routeur_bancaire.valider_comparaison(
        payload.colonnes_comparaison, payload.mode_comparaison
    )


def _vocabulaire_nettoye(payload) -> dict[str, list[str]]:
    """Les trois listes de mots-clés du type d'opération, vérifiées ensemble :
    un même mot ne peut pas désigner à la fois un achat et une vente.

    Réutilise le nettoyeur du noyau — même règle, même normalisation, mêmes
    messages que pour le sens et l'état d'un relevé bancaire.
    """
    return routeur_bancaire.nettoyer_vocabulaire(
        {
            "libelles_type_achat": payload.libelles_type_achat,
            "libelles_type_vente": payload.libelles_type_vente,
            "libelles_type_transfert": payload.libelles_type_transfert,
        },
        "types d'opération",
    )


# ---------- Presets ----------


@router.get("/presets", response_model=list[schemas.ImportPresetRead])
def list_presets(db: Session = Depends(get_db)):
    presets = crud.list_import_presets(db, DOMAINE)
    for preset in presets:
        preset.dernier_import = crud.get_date_dernier_import(db, preset.id)
    return presets


@router.post("/presets", response_model=schemas.ImportPresetRead, status_code=201)
def create_preset(payload: schemas.ImportPresetCreate, db: Session = Depends(get_db)):
    _valider_compte_placement(db, payload.compte_id)
    _valider_configuration(payload)
    return crud.create_import_preset(
        db,
        payload.nom,
        [c.model_dump() for c in payload.colonnes],
        payload.colonnes_comparaison,
        ignorer_premiere_ligne=payload.ignorer_premiere_ligne,
        compte_id=payload.compte_id,
        mode_comparaison=payload.mode_comparaison.value,
        domaine=DOMAINE,
        mode_lecture=_mode_lecture(payload).value,
        **_vocabulaire_nettoye(payload),
    )


@router.get("/presets/{preset_id}", response_model=schemas.ImportPresetRead)
def get_preset(preset_id: int, db: Session = Depends(get_db)):
    return _get_preset_ou_404(db, preset_id)


@router.put("/presets/{preset_id}", response_model=schemas.ImportPresetRead)
def update_preset(
    preset_id: int, payload: schemas.ImportPresetUpdate, db: Session = Depends(get_db)
):
    preset = _get_preset_ou_404(db, preset_id)
    _valider_compte_placement(db, payload.compte_id)
    _valider_configuration(payload)
    return crud.update_import_preset(
        db,
        preset,
        nom=payload.nom,
        colonnes=[c.model_dump() for c in payload.colonnes],
        colonnes_comparaison=payload.colonnes_comparaison,
        mode_comparaison=payload.mode_comparaison.value,
        ignorer_premiere_ligne=payload.ignorer_premiere_ligne,
        compte_id=payload.compte_id,
        mode_lecture=_mode_lecture(payload).value,
        **_vocabulaire_nettoye(payload),
    )


@router.delete("/presets/{preset_id}")
def delete_preset(preset_id: int, db: Session = Depends(get_db)):
    """Supprime un preset et tout ce qui lui est rattaché (correspondances,
    historique, stock anti-doublons — par cascade).

    Pas de garde « dernier preset restant » ici, contrairement au noyau : la
    page Import du noyau serait inutilisable sans preset, alors que celle-ci
    propose d'en créer un. Le compte n'est de toute façon jamais touché.
    """
    preset = _get_preset_ou_404(db, preset_id)
    crud.delete_import_preset(db, preset)
    return {"supprime": True}


# ---------- Vocabulaire par défaut ----------


@router.get("/vocabulaire-defaut")
def vocabulaire_defaut():
    """Les mots-clés reconnus quand un preset n'en déclare aucun.

    Affichés sous chaque champ de l'écran de configuration : sans eux,
    l'utilisateur ne peut pas savoir ce que « laisser vide » veut dire, et
    recopie par prudence un vocabulaire qu'il a déjà.
    """
    return {
        type_placement.value: sorted(libelles)
        for type_placement, libelles in LIBELLES_TYPE_PLACEMENT_DEFAUT.items()
    }


# ---------- Comptes de placements ----------


@router.get("/comptes")
def list_comptes_placement(db: Session = Depends(get_db)):
    """Les comptes-titres, pour le sélecteur « compte pour ce fichier ».

    L'extension « Placements financiers » expose déjà la même liste enrichie
    sous /placements, mais avec ses valorisations et ses détentions : ici, seuls
    l'identifiant, le nom et la monnaie principale servent.
    """
    return [
        {
            "id": compte.id,
            "nom": compte.nom,
            "monnaie_id": compte.monnaie_principale_id,
        }
        for compte in placements.get_comptes_placement(db)
    ]


# ---------- Import (scopé à un preset) ----------


@router.post(
    "/presets/{preset_id}/previsualiser", response_model=schemas_pl.ApercuPlacements
)
async def previsualiser(
    preset_id: int,
    fichier: UploadFile = File(...),
    overrides: str = Form("{}"),
    compte_id_defaut: Optional[int] = Form(None),
    delimiteur: Optional[str] = Form(None),
    separateur_decimal: Optional[str] = Form(None),
    date_position: Optional[date_type] = Form(None),
    db: Session = Depends(get_db),
):
    """`date_position` : la date de la PHOTOGRAPHIE, pour un preset qui en lit
    une. Un relevé de position ne dit pas quand il a été pris — c'est cette date
    qui datera toutes les lignes créées. Sans objet pour une liste d'opérations,
    qui date chaque ligne elle-même.

    `overrides` : les retouches déjà faites dans l'aperçu, rejouées avant de
    le rendre — sans quoi il continuerait d'annoncer ce que l'utilisateur vient
    de corriger (cf. service.previsualiser). Même forme qu'à la confirmation,
    et volontairement : l'aperçu doit montrer exactement ce que la confirmation
    fera."""
    _get_preset_ou_404(db, preset_id)
    delimiteur = routeur_bancaire._valider_delimiteur(delimiteur)
    separateur_decimal = routeur_bancaire._valider_separateur_decimal(separateur_decimal)
    _valider_compte_placement(db, compte_id_defaut)
    contenu = await fichier.read()
    try:
        decodes = schemas_pl.OverridesPlacements.model_validate_json(overrides)
    except Exception:
        raise HTTPException(status_code=400, detail="overrides invalide (JSON attendu)")
    try:
        return service.previsualiser(
            db,
            preset_id,
            contenu,
            compte_id_defaut=compte_id_defaut,
            delimiteur=delimiteur,
            separateur_decimal=separateur_decimal,
            date_position=date_position,
            overrides=decodes,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Fichier illisible : {exc}")


@router.post("/presets/{preset_id}/confirmer", response_model=schemas_pl.ResultatPlacements)
async def confirmer(
    preset_id: int,
    fichier: UploadFile = File(...),
    overrides: str = Form("{}"),
    compte_id_defaut: Optional[int] = Form(None),
    delimiteur: Optional[str] = Form(None),
    separateur_decimal: Optional[str] = Form(None),
    date_position: Optional[date_type] = Form(None),
    db: Session = Depends(get_db),
):
    _get_preset_ou_404(db, preset_id)
    delimiteur = routeur_bancaire._valider_delimiteur(delimiteur)
    separateur_decimal = routeur_bancaire._valider_separateur_decimal(separateur_decimal)
    _valider_compte_placement(db, compte_id_defaut)
    contenu = await fichier.read()
    try:
        decodes = schemas_pl.OverridesPlacements.model_validate_json(overrides)
    except Exception:
        raise HTTPException(status_code=400, detail="overrides invalide (JSON attendu)")
    try:
        return service.confirmer(
            db,
            preset_id,
            contenu,
            decodes,
            nom_fichier=fichier.filename or "",
            compte_id_defaut=compte_id_defaut,
            delimiteur=delimiteur,
            separateur_decimal=separateur_decimal,
            date_position=date_position,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Fichier illisible : {exc}")


# ---------- Historique ----------


@router.get(
    "/presets/{preset_id}/historique", response_model=list[schemas.ImportHistoriqueRead]
)
def get_historique(preset_id: int, db: Session = Depends(get_db)):
    """Même lecture que côté bancaire, y compris le nombre d'opérations encore
    annulables : le mécanisme est celui du noyau (le stock anti-doublons est le
    seul registre du lien import -> opération), il ne dépend d'aucun domaine."""
    _get_preset_ou_404(db, preset_id)
    compteurs = crud.compter_operations_annulables(db, preset_id)

    def _lecture(entree) -> schemas.ImportHistoriqueRead:
        compteur = compteurs.get(entree.id, {"annulables": 0, "sans_lien": 0})
        annulables = compteur["annulables"]
        raison = None
        if annulables == 0:
            raison = "anterieur" if compteur["sans_lien"] else "deja_supprime"
        return schemas.ImportHistoriqueRead(
            **{
                champ: getattr(entree, champ)
                for champ in (
                    "id",
                    "date_import",
                    "nom_fichier",
                    "operations_creees",
                    "lignes_ignorees",
                    "doublons_detectes",
                )
            },
            operations_annulables=annulables,
            raison_non_annulable=raison,
        )

    return [_lecture(entree) for entree in crud.get_import_historique(db, preset_id)]


@router.delete(
    "/presets/{preset_id}/historique/{historique_id}",
    response_model=schemas.ImportAnnulationResultat,
)
def annuler_import(preset_id: int, historique_id: int, db: Session = Depends(get_db)):
    """Défait un import de placements : ses opérations, et sa trace.

    `import_bancaire.annuler_import` fait le travail SANS UNE LIGNE DE PLUS, et
    c'est voulu : il passe par `crud.delete_operation`, qui sait déjà défaire
    « le versant titres d'un achat/vente » et les deux jambes d'un virement.
    Écrire ici une seconde version de cette liste l'aurait condamnée à diverger
    au premier ajout.
    """
    _get_preset_ou_404(db, preset_id)
    entree = crud.get_import_historique_entree(db, historique_id)
    if entree is None or entree.preset_id != preset_id:
        raise HTTPException(status_code=404, detail="Import introuvable")
    return import_bancaire.annuler_import(db, historique_id)


# ---------- Doublons de transferts ----------


@router.post("/presets/{preset_id}/doublons-transferts", response_model=schemas.VirementsDoublonsRead)
def doublons_transferts(
    preset_id: int, payload: schemas_pl.ApercuPlacements, db: Session = Depends(get_db)
):
    """Les transferts de l'aperçu qui ressemblent à un virement DÉJÀ EN BASE.

    Le rapprochement lui-même est celui du noyau, sans une adaptation :
    `detecter_doublons_virements` compare des transactions (deux comptes, un
    montant, une date voisine), pas des lignes de fichier. Un transfert lu ici
    se rapproche donc aussi bien d'un virement saisi à la main que d'un virement
    importé d'un relevé BANCAIRE — c'est exactement ce qu'on veut, puisque le
    même mouvement figure sur les deux relevés.

    RESTREINT AU COMPTE DU PRESET. Un relevé de courtier ne décrit qu'un compte,
    celui du preset : se comparer à tous les virements de la base ferait se
    signaler l'un l'autre deux mouvements de même montant faits la même semaine
    entre des comptes sans rapport. Un preset qui ne nomme aucun compte (le
    fichier en désigne alors un par import) n'a rien à restreindre : on regarde
    tout, comme avant.

    Purement consultatif, comme côté bancaire : rien n'est bloqué, rien n'est
    écarté. L'app montre, l'utilisateur tranche.
    """
    preset = _get_preset_ou_404(db, preset_id)
    candidats = service.candidats_doublons_virements(payload.lignes)
    return schemas.VirementsDoublonsRead(
        resultats=import_bancaire.detecter_doublons_virements(
            db, candidats, {preset.compte_id} if preset.compte_id else None
        )
    )
