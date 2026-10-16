"""L'affectation globale des propriétés aux colonnes (services/
affectation_colonnes), et sa comparaison avec l'ancienne attribution
gloutonne sur tout le banc de détection.

Ce qu'on verrouille : l'algorithme hongrois trouve bien l'optimum ; une
colonne ne rafle plus une propriété qu'une autre portait presque aussi bien ;
le montant ne se lit que d'une façon que le serveur accepte ; ce que le solde a
prouvé reste posé ; un champ obligatoire manquant est comblé et signalé ; et
sur le banc, aucun cas ne fait moins bien qu'avec le glouton.
"""
import random
from itertools import permutations

from app.services import detection_colonnes
from app.services.affectation_colonnes import _hongrois, affecter
from tests.banc_detection.rejouer import evaluer
from tests.banc_detection.variantes import tous_les_cas


def test_le_hongrois_trouve_l_optimum():
    rng = random.Random(7)
    for _ in range(40):
        n, m = rng.randint(1, 5), rng.randint(5, 7)
        couts = [[rng.uniform(-3, 3) for _ in range(m)] for _ in range(n)]
        choix = _hongrois(couts)
        assert len(set(choix)) == n
        total = sum(couts[i][j] for i, j in enumerate(choix))
        meilleur = min(sum(couts[i][j] for i, j in enumerate(p)) for p in permutations(range(m), n))
        assert abs(total - meilleur) < 1e-9


def test_une_colonne_ne_rafle_plus_ce_qu_une_autre_porte_presque_aussi_bien():
    """Le glouton donnait la date à la colonne 1 (1,0) et ne laissait rien de
    bon à la colonne 2 ; ensemble, 1 → libellé et 2 → date valent mieux."""
    scores = {1: {"date": 1.0, "nature": 0.9}, 2: {"date": 0.95, "nature": 0.1}}
    retenue, faibles = affecter(scores)
    assert retenue == {1: "nature", 2: "date"}
    # Aucune colonne n'a l'air d'un montant : rien à combler, rien d'inventé.
    assert faibles == []


def test_le_montant_se_lit_d_une_seule_facon():
    scores = {
        1: {"date": 1.6},
        2: {"nature": 1.6},
        3: {"montant": 0.9, "montant_debit": 1.1},
        4: {"montant_credit": 1.1, "sens": 0.9},
    }
    retenue, _ = affecter(scores)
    assert (retenue[3], retenue[4]) == ("montant_debit", "montant_credit")
    # Jamais un sens avec le couple, jamais le montant avec lui.
    assert "sens" not in retenue.values() and "montant" not in retenue.values()


def test_jamais_une_moitie_de_couple():
    scores = {
        1: {"date": 1.6},
        2: {"nature": 1.6},
        3: {"montant_debit": 1.5, "montant": 1.2},
    }
    retenue, _ = affecter(scores)
    assert retenue[3] == "montant"


def test_les_verrous_tiennent_meme_contre_une_somme_meilleure():
    scores = {1: {"date": 1.6}, 2: {"nature": 1.6, "": 0.2}, 3: {"montant": 1.5, "": 2.5}}
    retenue, _ = affecter(scores, verrous={3: ""})
    assert retenue[3] == ""


def test_un_champ_obligatoire_manquant_est_comble_et_signale():
    scores = {
        1: {"date": 0.2, "nature": 0.15},
        2: {"nature": 1.5},
        3: {"montant": 1.2},
        4: {"": 1.2, "date": 0.3},  # un solde : jamais pris pour combler
    }
    retenue, faibles = affecter(scores)
    assert retenue[1] == "date" and retenue[4] == ""
    assert faibles == ["date"]


def _glouton(scores, verrous=None, seuil=0.35):
    """L'attribution d'avant le point 5, telle qu'elle était, pour comparer."""
    candidats = sorted(
        ((v, index, prop) for index, s in scores.items() for prop, v in s.items()), reverse=True
    )
    retenue, prises = {}, set()
    for valeur, index, prop in candidats:
        if index in retenue or valeur < seuil:
            continue
        if prop and prop in prises:
            continue
        if prop == "montant" and prises & {"montant_debit", "montant_credit"}:
            continue
        if prop in ("montant_debit", "montant_credit") and "montant" in prises:
            continue
        retenue[index] = prop
        if prop:
            prises.add(prop)
    return retenue, []


def test_aucun_cas_du_banc_ne_fait_moins_bien_qu_avec_le_glouton(monkeypatch):
    cas = tous_les_cas(avec_reels=False)
    globale = {c.nom: evaluer(c).colonnes_justes for c in cas}
    monkeypatch.setattr(detection_colonnes, "affecter", _glouton)
    gloutonne = {c.nom: evaluer(c).colonnes_justes for c in cas}
    pires = [nom for nom in globale if globale[nom] < gloutonne[nom]]
    assert not pires
    assert sum(globale.values()) >= sum(gloutonne.values())
