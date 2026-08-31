"""Point d'entrée backend de l'extension « Monnaies ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

ELLE EMPORTE AUSSI LES TAUX DE CHANGE (`/monnaies/taux`) et la vue du dashboard
convertie en une seule monnaie. Ce n'est pas une monnaie de référence introduite
dans l'application : rien n'est réécrit, et la conversion ne s'applique qu'à un
écran, sur une bascule qu'on allume. Éteindre l'extension la fait disparaître et
rend le dashboard à ses onglets par monnaie.

L'EXTENSION EMPORTE LES ROUTES D'ÉCRITURE, PAS CELLE DE LECTURE.
`GET /monnaies` est resté dans le noyau : afficher un montant demande de
connaître son symbole, et c'est vrai de tous les écrans, extension ou pas.
Ce qui part ici, c'est la création, le renommage et la suppression — le droit
d'avoir PLUSIEURS monnaies, qui est la fonctionnalité optionnelle.

Sans ce dossier, la base garde la monnaie posée à l'installation et l'interface
se replie d'elle-même sur le cas mono-devise, qu'elle sait déjà traiter.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import crud
from app.extensions import exiger_extension

from routeur_monnaies import router as router_monnaies
from routeur_taux_manuels import router as router_taux_manuels

router = APIRouter(dependencies=[Depends(exiger_extension("monnaies"))])
router.include_router(router_monnaies)
# Les taux de change et la vue convertie. ICI PLUTÔT QUE DANS « Lecture de
# cours » : convertir n'a rien à voir avec aller chercher un cours en ligne, et
# faire dépendre une fonction ordinaire du multi-devises de la seule extension
# qui ouvre une connexion sortante contredirait la promesse de l'application.
router.include_router(router_taux_manuels)


def obstacle_a_la_desactivation(db: Session) -> Optional[str]:
    """Ce qui empêche d'éteindre cette extension-ci, ou None.

    Le noyau appelle cette fonction avant chaque extinction, sur le module
    backend de l'extension concernée (cf. app/extensions.py,
    `obstacle_a_la_desactivation`) : c'est la seule chose que cette extension
    ajoute au mécanisme, et le noyau ne sait toujours rien des monnaies.

    LA RAISON. Éteindre une extension est censé être sans conséquence : l'écran
    disparaît, les routes se ferment, les données restent. C'est vrai ici aussi
    des données — mais pas de leur LISIBILITÉ. Sans cette extension, tout ce qui
    permet de tenir plusieurs monnaies (en créer, en renommer, en supprimer)
    disparaît, et l'application se replie sur le cas mono-devise. Une base qui
    porte déjà des comptes ou des opérations dans deux monnaies se retrouverait
    alors décrite par une interface qui n'en prévoit qu'une, sans plus aucun
    moyen de revenir en arrière depuis cet écran-là.

    CE QU'ON COMPTE : les monnaies UTILISÉES, pas celles créées. Avoir ajouté le
    dollar « au cas où » sans jamais s'en servir laisse l'application
    strictement mono-devise ; retenir l'utilisateur pour une ligne de table dont
    rien ne dépend serait un verrou sans objet. Il lui reste d'ailleurs la
    sortie évidente : supprimer la monnaie inutilisée, ce que cette extension
    autorise justement tant qu'elle ne sert à rien.
    """
    utilisees = crud.monnaies_utilisees(db)
    if len(utilisees) <= 1:
        return None
    noms = ", ".join(
        f"« {monnaie.nom} »"
        for monnaie in crud.get_monnaies(db)
        if monnaie.id in utilisees
    )
    return (
        "Des comptes ou des opérations sont tenus dans plusieurs monnaies "
        f"({noms}) : éteindre cette extension replierait l'application sur une "
        "seule devise, et ces montants ne seraient plus décrits correctement. "
        "Ramène tout à une seule monnaie avant de la désactiver."
    )
