"""À QUI on doit, et QUI nous doit (extension « Suivi des remboursements »).

CE QUI MANQUAIT. L'application sait depuis longtemps COMBIEN il reste à
rembourser : une dépense remboursable porte son reste dû, un prêt reçu aussi, et
les remboursements les font décroître (cf. models.RemboursementLien). Elle ne
sait rien de la seule chose qui permet d'agir dessus — de qui il s'agit. Devant
quinze dépenses avancées sur six mois, « il te reste 340 € à récupérer » ne dit
pas à qui écrire.

UN PROFIL EST UNE ÉTIQUETTE, ET RIEN DE PLUS — même nature que `TypeTitre` : un
nom, une note, un ordre d'affichage. AUCUN calcul du noyau ne le lit : ni un
solde, ni un KPI, ni une barre d'histogramme. C'est ce qui permet de le laisser
entièrement libre (une personne, une entreprise, « la colocation »), de le
supprimer sans conséquence — les opérations redeviennent simplement non
rattachées — et d'éteindre l'extension sans rien perdre.

UNE COLONNE SUR `operation`, PAS UNE TABLE DE LIAISON. Une dépense remboursable
porte UN reste dû, un seul montant : elle est donc due par une seule partie.
Répartir une addition entre trois personnes demanderait trois montants dus, ce
que le modèle ne porte pas — et une table de liaison aurait laissé croire le
contraire. Un dîner partagé se saisit comme trois dépenses, ou se découpe.

LES QUATRE TYPES CONCERNÉS, et le rôle différent de deux d'entre eux :

  - `remboursable` et `pret` PORTENT LA DETTE. C'est leur `montant_a_rembourser`
    que le tableau somme, et eux seuls décident du solde d'un profil ;
  - `remboursements` et `remboursement_pret` sont des RÈGLEMENTS. Leur profil ne
    compte dans aucun total — la dette qu'ils soldent a déjà décru toute seule,
    et la compter une seconde fois la retirerait deux fois. Il ne sert qu'à
    l'historique : « ce que Marie m'a déjà rendu ».

NULL EST LE CAS ORDINAIRE, et le restera : la quasi-totalité des opérations
d'une base ne sont ni remboursables ni des prêts. Une valeur par défaut n'aurait
eu aucun sens à poser sur elles.

`ondelete="SET NULL"` : supprimer un profil détache ses opérations, il ne les
emporte pas. Ce sont de vraies écritures, qui bougent de vrais soldes — perdre
une dépense parce qu'on efface le nom d'une connaissance serait un désastre
silencieux.

Revision ID: 0054
Revises: 0053
Create Date: 2026-09-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "profil_remboursement",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nom", sa.String(), nullable=False),
        # Texte libre, jamais lu par un calcul : « voisin du dessus »,
        # « rembourse en fin de mois ». Non nullable et vide par défaut, comme
        # `SousFiltre.description` et `RegleCategorisation.description` — un NULL
        # aurait ajouté un second cas à tester dans chaque écran.
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        # Ordre d'affichage, fixé par l'utilisateur. Trier par nom aurait rangé
        # en tête celui dont le prénom commence par A, jamais celui qu'on
        # regarde.
        sa.Column("ordre", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        # Deux profils du même nom seraient impossibles à départager dans un
        # menu déroulant — et c'est par un menu déroulant qu'on les choisit.
        sa.UniqueConstraint("nom", name="uq_profil_remboursement_nom"),
    )

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("profil_remboursement_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_operation_profil_remboursement",
            "profil_remboursement",
            ["profil_remboursement_id"],
            ["id"],
            ondelete="SET NULL",
        )
    # Le seul accès de l'écran : toutes les opérations d'un profil.
    op.create_index(
        "ix_operation_profil_remboursement",
        "operation",
        ["profil_remboursement_id"],
    )


def downgrade():
    op.drop_index("ix_operation_profil_remboursement", table_name="operation")
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_constraint("fk_operation_profil_remboursement", type_="foreignkey")
        batch_op.drop_column("profil_remboursement_id")
    op.drop_table("profil_remboursement")
