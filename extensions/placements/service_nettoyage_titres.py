"""Nettoyer la base : regrouper les titres qui sont en réalité le même, et les fusionner.

POURQUOI. Le rapprochement de l'import (rapprochement_titres) évite les doublons AU MOMENT d'importer une
composition ; il ne répare pas ceux qui lui ont échappé (un titre saisi à la main puis importé sous un autre nom,
deux fichiers d'émetteurs qui nomment la même société à leur façon, avant que le rapprochement existe). Ce module
relit TOUS les titres, propose des GROUPES de titres qui se ressemblent (nom d'origine, croisé avec secteur,
zone, devise et enveloppe) et, quand l'utilisateur le décide, les FUSIONNE.

`proposer` ne fait que lire. `fusionner` écrit, en une transaction, et refuse tout ce qui ne peut pas être le même
titre : deux ISIN différents, un indice et un titre ordinaire, deux monnaies de cotation quand le titre absorbé a des
mouvements (ses prix sont libellés dans la sienne).

CE QUE LA FUSION DÉPLACE : les mouvements (et donc les détentions), les citations dans les compositions des ETF
(`titre:<id>` ou ISIN, regroupées et additionnées si l'ETF citait les deux), les répartitions que le titre gardé n'a pas,
l'ISIN, le nom affiché, le cours et le lien de cours qu'il n'avait pas, le drapeau « part d'un ETF », et les ETF
calqués sur un indice absorbé. Puis le titre absorbé disparaît.
"""
from typing import Optional

import rapprochement_titres as rapprochement
from app import crud, models
from app.constants import AXES_EXPOSITION
from app.services import exposition, placements

NB_MAX_GROUPES = 200


def _resume(titre, detenus: set[int], utilises: set[int]) -> dict:
    return {
        "id": titre.id,
        "nom": titre.nom,
        "nom_affiche": titre.nom_affiche,
        "isin": titre.code_isin,
        "monnaie": titre.monnaie.symbole,
        "enveloppe": titre.type_titre.nom if titre.type_titre else None,
        "secteur": (titre.repartition("secteur")[0].etiquette.nom if titre.repartition("secteur") else None),
        "zone": (titre.repartition("zone")[0].etiquette.nom if titre.repartition("zone") else None),
        "detenu": titre.id in detenus,
        "mouvements": titre.id in utilises,
        "part_etf": bool(titre.part_etf),
        "est_indice": bool(titre.est_indice),
        "nb_repartitions": len(titre.expositions),
        "a_composition": bool(titre.composition),
    }


def _poids_du_gardien(r: dict) -> tuple:
    """Qui garder dans un groupe : celui qui a un ISIN, puis celui qui porte des mouvements (on ne déplace pas un
    historique sans nécessité), puis le mieux renseigné, puis le plus ancien."""
    return (not r["isin"], not (r["detenu"] or r["mouvements"]), -r["nb_repartitions"], r["id"])


def proposer(db) -> list[dict]:
    """Les groupes de titres qui se ressemblent, du plus sûr au moins sûr. Chaque groupe : ses membres, la note
    de leur ressemblance, les raisons, et le titre proposé comme gardien."""
    titres = [t for t in crud.get_titres(db, inclure_archivees=True)]
    detenus = placements.titres_detenus(db)
    utilises = {t.id for t in titres if crud.titre_est_utilise(db, t.id)}
    index = rapprochement.IndexMots(titres)
    parent = {t.id: t.id for t in titres}

    def racine(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    liens = []
    vus = set()
    for a in titres:
        for b in index.candidats(a.nom):
            if b.id <= a.id or (a.id, b.id) in vus:
                continue
            vus.add((a.id, b.id))
            r = rapprochement.score_paire(a, b)
            if r is None:
                continue
            liens.append((a.id, b.id, r))
            parent[racine(a.id)] = racine(b.id)
    par_titre = {t.id: t for t in titres}
    groupes: dict[int, dict] = {}
    for a, b, r in liens:
        g = groupes.setdefault(racine(a), {"ids": set(), "notes": [], "raisons": set()})
        g["ids"].update((a, b))
        g["notes"].append(r.score)
        g["raisons"].update(r.raisons)
    resultat = []
    for g in groupes.values():
        membres = [_resume(par_titre[i], detenus, utilises) for i in sorted(g["ids"])]
        gardien = min(membres, key=_poids_du_gardien)["id"]
        resultat.append(
            {
                "score": round(min(g["notes"]), 3),
                "meilleur_score": round(max(g["notes"]), 3),
                "raisons": sorted(g["raisons"]),
                "gardien_propose": gardien,
                "membres": membres,
            }
        )
    resultat.sort(key=lambda g: (-g["score"], -g["meilleur_score"], g["membres"][0]["nom"].lower()))
    return resultat[:NB_MAX_GROUPES]


class ErreurFusion(ValueError):
    """Une fusion qui ne peut pas avoir lieu."""


def _remplacer_citations(db, absorbe: models.TitrePossede, garde: models.TitrePossede, cle_absorbe_avant: str) -> None:
    """Dans la composition de chaque ETF, tout ce qui citait le titre absorbé cite désormais le titre gardé ; si l'ETF
    citait les deux, les poids s'additionnent. Toutes les clés sont ramenées à leur forme canonique au passage."""
    par_isin = {exposition.normaliser_isin(t.code_isin): t for t in crud.get_titres(db, inclure_archivees=True) if t.code_isin}
    par_id = {t.id: t for t in crud.get_titres(db, inclure_archivees=True)}
    for etf in db.query(models.TitrePossede).filter(models.TitrePossede.composition.isnot(None)).all():
        if not etf.composition:
            continue
        nouvelle: dict[str, float] = {}
        change = False
        for cle, poids in etf.composition.items():
            cible = exposition.composant_de(cle, par_isin, par_id)
            if cible is not None and cible.id == absorbe.id:
                cible = garde
            nouvelle_cle = exposition.cle_composant(cible) if cible is not None else cle
            if nouvelle_cle != cle:
                change = True
            nouvelle[nouvelle_cle] = round(nouvelle.get(nouvelle_cle, 0.0) + poids, 6)
        if change or len(nouvelle) != len(etf.composition):
            etf.composition = nouvelle
            if etf.composition_couverture_pct is not None:
                etf.composition_couverture_pct = round(sum(nouvelle.values()), 4) or etf.composition_couverture_pct


def fusionner(db, garder_id: int, absorber_ids: list[int]) -> dict:
    """Fusionne les titres `absorber_ids` dans le titre `garder_id`. Une transaction : tout ou rien."""
    garde = crud.get_titre(db, garder_id)
    if garde is None:
        raise ErreurFusion("le titre à garder n'existe plus")
    absorbes = []
    for i in dict.fromkeys(absorber_ids):
        if i == garder_id:
            continue
        titre = crud.get_titre(db, i)
        if titre is None:
            raise ErreurFusion("un titre à fusionner n'existe plus")
        absorbes.append(titre)
    if not absorbes:
        raise ErreurFusion("rien à fusionner")
    isin_pris = exposition.normaliser_isin(garde.code_isin)
    for titre in absorbes:
        if titre.est_indice != garde.est_indice:
            raise ErreurFusion(f"« {titre.nom_affiche} » et « {garde.nom_affiche} » : un indice ne se fond pas dans un titre ordinaire")
        isin = exposition.normaliser_isin(titre.code_isin)
        if isin and isin_pris and isin != isin_pris:
            raise ErreurFusion(f"« {titre.nom_affiche} » et « {garde.nom_affiche} » ont deux ISIN différents : ce sont deux titres")
        if titre.monnaie_id != garde.monnaie_id and crud.titre_est_utilise(db, titre.id):
            raise ErreurFusion(
                f"« {titre.nom_affiche} » a des mouvements dans une autre monnaie de cotation que « {garde.nom_affiche} » : fusion refusée"
            )
        isin_pris = isin_pris or isin

    deplaces = 0
    for titre in absorbes:
        cle_avant = exposition.cle_composant(titre)
        # L'ISIN passe au titre gardé qui n'en a pas (libéré d'abord : il est unique).
        if titre.code_isin and not garde.code_isin:
            isin = titre.code_isin
            titre.code_isin = None
            db.flush()
            garde.code_isin = isin
        for mouvement in db.query(models.OperationTitre).filter(models.OperationTitre.titre_id == titre.id):
            mouvement.titre_id = garde.id
            deplaces += 1
        for axe in AXES_EXPOSITION:
            if not garde.repartition(axe.value) and titre.repartition(axe.value):
                crud.poser_repartition(
                    db, garde, axe.value,
                    [(e.type_titre_id, e.poids_pct) for e in titre.repartition(axe.value)],
                    source=titre.repartition(axe.value)[0].source,
                    date_maj=titre.repartition(axe.value)[0].date_maj,
                )
        if not garde.nom_affichage and titre.nom_affichage:
            garde.nom_affichage = titre.nom_affichage
        if not garde.valeur and titre.valeur:
            garde.valeur = titre.valeur
        if not garde.url_cours and titre.url_cours:
            garde.url_cours = titre.url_cours
        if not garde.type_titre_id and titre.type_titre_id and not garde.est_indice:
            garde.type_titre_id = titre.type_titre_id
        if titre.composition and not garde.composition:
            garde.composition = dict(titre.composition)
            garde.composition_couverture_pct = titre.composition_couverture_pct
        garde.part_etf = bool(garde.part_etf or titre.part_etf)
        for lie in db.query(models.TitrePossede).filter(models.TitrePossede.indice_id == titre.id):
            lie.indice_id = garde.id
        db.flush()
        _remplacer_citations(db, titre, garde, cle_avant)
        db.flush()
        db.expire(titre)
        db.delete(titre)
        db.flush()
    db.commit()
    return {"garde_id": garde.id, "garde_nom": garde.nom_affiche, "fusionnes": len(absorbes), "mouvements_deplaces": deplaces}
