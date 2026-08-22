"""API des extensions : ce que le frontend interroge au démarrage pour savoir
quelles fonctionnalités charger, et par où les Paramètres les allument.

Ce routeur ne dépend d'aucune extension en particulier : il ne connaît que le
mécanisme (cf. app/extensions.py). Une application sans aucun dossier
d'extension le sert quand même, en rendant une liste vide.
"""
import mimetypes

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .. import extensions as extensions_noyau
from ..schemas import ExtensionEtatUpdate, ExtensionsAnnonceesUpdate

router = APIRouter(prefix="/extensions", tags=["extensions"])


def _extension_ou_404(extension_id: str):
    trouvees = extensions_noyau.decouvrir()
    extension = trouvees.get(extension_id)
    if extension is None:
        raise HTTPException(status_code=404, detail="Extension introuvable")
    return extension


@router.get("")
def list_extensions():
    """Les extensions présentes, avec leur état.

    REDÉCOUVERTES À CHAQUE APPEL plutôt que mises en cache au démarrage :
    déposer un dossier d'extension pendant que l'application tourne la fait
    apparaître au rechargement de la page, sans redémarrage. Le coût est un
    parcours de deux dossiers, négligeable devant la requête HTTP elle-même.

    Les routes backend, elles, restent celles montées au démarrage : une
    extension ajoutée à chaud s'affiche mais ne répondra qu'après relance
    (cf. app/extensions.py, en-tête)."""
    trouvees = extensions_noyau.decouvrir()
    return [
        extension.en_dict(
            extensions_noyau.est_active(extension_id),
            extensions_noyau.est_annoncee(extension_id),
        )
        for extension_id, extension in trouvees.items()
    ]


@router.post("/annoncees")
def marquer_annoncees(payload: ExtensionsAnnonceesUpdate):
    """Acquitte la fenêtre d'annonce : ces extensions ne la déclencheront plus.

    APPELÉ À LA FERMETURE de la fenêtre, pas à son ouverture. « Annoncée »
    veut dire « l'utilisateur l'a vue et fermée » : si l'application se ferme
    pendant que la fenêtre est encore ouverte, il n'a rien acquitté et
    l'annonce revient au lancement suivant, ce qui est le comportement voulu.

    Rangée avec les autres chemins fixes, avant ceux à paramètre : rien ne
    l'impose ici (POST, là où `/{extension_id}` est un PUT — aucune collision
    possible), mais garder l'ordre « fixes d'abord » évite d'avoir à vérifier
    la méthode HTTP le jour où l'un des deux change.
    """
    extensions_noyau.marquer_annoncees(payload.ids)
    return {"annoncees": payload.ids}


@router.get("/erreurs")
def get_erreurs():
    """Les extensions présentes qui n'ont pas pu être chargées au démarrage.

    Déclarée AVANT les routes à paramètre : « erreurs » serait sinon capté par
    `/{extension_id}` selon l'ordre d'enregistrement, et cette route ne
    répondrait jamais.

    Affiché en avertissement dans les Paramètres : une extension présente sur
    le disque mais silencieusement absente de l'interface est le genre de panne
    qu'on met une heure à comprendre."""
    return {"erreurs": extensions_noyau.ERREURS_CHARGEMENT}


@router.put("/{extension_id}")
def set_extension(extension_id: str, payload: ExtensionEtatUpdate):
    """Active ou désactive une extension.

    AUCUNE DONNÉE N'EST TOUCHÉE. Désactiver « Placements financiers » masque
    la page et ferme ses routes ; les titres et les mouvements restent en base
    et réapparaissent intacts à la réactivation. C'est le comportement retenu
    parce qu'un testeur doit pouvoir essayer une extension sans risquer son
    portefeuille — et parce qu'une désactivation destructive serait un piège à
    un clic."""
    _extension_ou_404(extension_id)
    extensions_noyau.definir_active(extension_id, payload.actif)
    return {"id": extension_id, "actif": payload.actif}


@router.get("/{extension_id}/fichiers/{chemin:path}")
def get_fichier_extension(extension_id: str, chemin: str):
    """Sert un fichier frontend d'une extension (JS, CSS, fragment HTML).

    Les fichiers d'une extension ne peuvent pas être servis par le montage
    statique du frontend : ils vivent hors de `frontend/`, dans le dossier de
    leur extension, précisément pour pouvoir être retirés avec lui.

    Servi même quand l'extension est DÉSACTIVÉE, et c'est voulu : le frontend
    charge le code de toutes les extensions présentes puis n'active que les
    écrans utiles. Refuser le fichier obligerait à recharger la page entière à
    chaque bascule, là où l'interface se met à jour toute seule.

    `chemin:path` accepte les sous-dossiers ; le passage obligé par
    `chemin_frontend` (cf. app/extensions.py) est ce qui empêche d'en sortir
    par un `..`."""
    extension = _extension_ou_404(extension_id)
    fichier = extension.chemin_frontend(chemin)
    if fichier is None:
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    # Type deviné sur l'extension du nom : sans lui, le navigateur refuse
    # d'exécuter un module JavaScript servi en `application/octet-stream`.
    type_mime, _ = mimetypes.guess_type(fichier.name)
    return FileResponse(
        fichier,
        media_type=type_mime or "application/octet-stream",
        # Même politique que le frontend principal (cf. main.NoCacheStaticFiles) :
        # un fichier d'extension périmé en cache casserait la page aussi
        # silencieusement.
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )
