"""Quatre relevés inventés, un par mode de lecture des montants.

En attendant les vrais (releves/, hors git), et ensuite à côté d'eux : ce sont
les seuls cas que la référence versionnée peut citer. Ils imitent des formes
d'exports français courants, sans reprendre ceux d'une banque précise.

  - banque_a : montant algébrique, titres au-dessus des intitulés, cp1252,
    ordre décroissant ;
  - banque_b : débit / crédit, date de valeur, solde à chaque ligne, UTF-8 avec
    BOM ;
  - banque_c : montant positif + sens, catégorie, séparateur « , » donc point
    décimal, dates ISO, ligne de total en pied ;
  - banque_d : envoyé / reçu dans un xlsx, détail, référence, solde donné
    seulement en fin de journée, ordre décroissant.

Tout est tiré d'un générateur à graine fixe : mêmes octets à chaque exécution.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, timedelta

from .releve import Releve, texte_montant

_DEBUT, _FIN = date(2026, 1, 2), date(2026, 5, 29)
_SOLDE_INITIAL = 152_340  # centimes


@dataclass
class _Operation:
    jour: date
    libelle: str
    detail: str
    categorie: str
    centimes: int


# (libellé, détail, catégorie, minimum, maximum) en centimes, signe compris.
_COURANTES = (
    ("CB CARREFOUR MARKET {jj}/{mm}", "Paiement par carte", "Alimentation", -12_000, -800),
    ("CB BOULANGERIE DU MARCHE {jj}/{mm}", "Paiement par carte", "Alimentation", -1_500, -180),
    ("CB SNCF INTERNET {jj}/{mm}", "Paiement par carte", "Transports", -9_800, -1_900),
    ("CB TOTAL ACCESS {jj}/{mm}", "Paiement par carte", "Carburant", -8_500, -3_000),
    ("CB AMAZON PAYMENTS {jj}/{mm}", "Paiement par carte", "Achats en ligne", -15_000, -900),
    ("RETRAIT DAB {jj}/{mm} LYON", "Retrait d'espèces", "Retraits", -10_000, -2_000),
    ("CB PHARMACIE CENTRALE {jj}/{mm}", "Paiement par carte", "Santé", -4_500, -350),
    ("VIR INST RECU DE M MARTIN", "Virement reçu", "Virements reçus", 1_000, 15_000),
    ("REMBOURSEMENT CPAM", "Virement reçu", "Santé", 250, 4_000),
)
# (jour du mois, libellé, détail, catégorie, montant fixe)
_MENSUELLES = (
    (1, "VIR SEPA RECU /DE EMPLOYEUR SA /MOTIF SALAIRE {mois}", "Virement reçu", "Revenus", 245_000),
    (5, "PRLV SEPA SCI LES TILLEULS LOYER", "Prélèvement", "Logement", -78_000),
    (10, "PRLV SEPA EDF CLIENTS PARTICULIERS", "Prélèvement", "Énergie", -6_432),
    (15, "PRLV SEPA FREE MOBILE", "Prélèvement", "Télécom", -1_999),
    (20, "VIR SEPA EMIS VERS LIVRET A", "Virement émis", "Épargne", -20_000),
)
_MOIS = ("JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI")


def _operations(graine: str) -> list[_Operation]:
    """Les opérations, en ordre CHRONOLOGIQUE. Plusieurs par jour, parfois
    aucune : c'est ce qui rend le test du solde en fin de journée intéressant."""
    rng = random.Random(graine)
    operations = []
    jour = _DEBUT
    while jour <= _FIN:
        for quantieme, libelle, detail, categorie, montant in _MENSUELLES:
            if jour.day == quantieme:
                operations.append(_Operation(
                    jour, libelle.format(mois=_MOIS[jour.month - 1]), detail, categorie, montant
                ))
        for _ in range(rng.choice((0, 0, 1, 1, 1, 2, 3))):
            libelle, detail, categorie, mini, maxi = rng.choice(_COURANTES)
            operations.append(_Operation(
                jour,
                libelle.format(jj=f"{jour.day:02d}", mm=f"{jour.month:02d}"),
                detail,
                categorie,
                rng.randint(mini, maxi),
            ))
        jour += timedelta(days=1)
    return operations


def _soldes(operations: list[_Operation]) -> list[int]:
    solde, soldes = _SOLDE_INITIAL, []
    for op in operations:
        solde += op.centimes
        soldes.append(solde)
    return soldes


def banque_a() -> Releve:
    ops = _operations("banque_a")
    lignes = [[op.jour.strftime("%d/%m/%Y"), op.libelle, texte_montant(op.centimes, ",")] for op in ops]
    return Releve(
        nom="banque_a",
        roles=["date", "nature", "montant"],
        entetes=["Date", "Libellé", "Montant (EUR)"],
        titres=[["Relevé de compte"], ["Compte courant n° 00012345678"], [""]],
        lignes=lignes[::-1],
        separateur=";",
        encodage="cp1252",
        ordre="decroissant",
    )


def banque_b() -> Releve:
    ops = _operations("banque_b")
    lignes = []
    for op, solde in zip(ops, _soldes(ops)):
        valeur = op.jour + timedelta(days=1 if op.centimes < 0 else 0)
        debit = texte_montant(-op.centimes, ",") if op.centimes < 0 else ""
        credit = texte_montant(op.centimes, ",") if op.centimes > 0 else ""
        lignes.append([
            op.jour.strftime("%d/%m/%Y"), valeur.strftime("%d/%m/%Y"), op.libelle,
            debit, credit, texte_montant(solde, ","),
        ])
    return Releve(
        nom="banque_b",
        roles=["date", "date_valeur", "nature", "debit", "credit", "solde"],
        entetes=["Date opération", "Date valeur", "Libellé", "Débit", "Crédit", "Solde"],
        lignes=lignes,
        separateur=";",
        encodage="utf-8-sig",
    )


def banque_c() -> Releve:
    ops = _operations("banque_c")
    lignes = [
        [
            op.jour.isoformat(), op.libelle, op.categorie,
            texte_montant(abs(op.centimes), "."), "Débit" if op.centimes < 0 else "Crédit",
        ]
        for op in ops
    ]
    total = sum(abs(op.centimes) for op in ops)
    return Releve(
        nom="banque_c",
        roles=["date", "nature", "categorie", "montant", "sens"],
        entetes=["Date", "Libellé", "Catégorie", "Montant", "Sens"],
        lignes=lignes,
        pied=[["", "Total des mouvements", "", texte_montant(total, "."), ""]],
        separateur=",",
        separateur_decimal=".",
        format_date="%Y-%m-%d",
    )


def banque_d() -> Releve:
    ops = _operations("banque_d")
    soldes = _soldes(ops)
    lignes = []
    for i, (op, solde) in enumerate(zip(ops, soldes)):
        # Le solde n'est donné qu'à la DERNIÈRE opération de chaque journée.
        fin_de_journee = i == len(ops) - 1 or ops[i + 1].jour != op.jour
        lignes.append([
            op.jour.strftime("%d/%m/%Y"), op.libelle, op.detail,
            texte_montant(-op.centimes, ",") if op.centimes < 0 else "",
            texte_montant(op.centimes, ",") if op.centimes > 0 else "",
            f"{op.jour:%Y%m%d}{100000 + i:06d}",
            texte_montant(solde, ",") if fin_de_journee else "",
        ])
    return Releve(
        nom="banque_d",
        roles=["date", "nature", "detail", "envoye", "recu", "reference", "solde"],
        entetes=["Date", "Description", "Détail", "Envoyé", "Reçu", "Référence", "Solde"],
        lignes=lignes[::-1],
        separateur="xlsx",
        ordre="decroissant",
    )


def bases() -> list[Releve]:
    return [banque_a(), banque_b(), banque_c(), banque_d()]
