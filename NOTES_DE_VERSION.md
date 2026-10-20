# Objectifs datés, import en étapes, export et copies de sécurité

## Nouveautés

- **Des projets avec une période et un montant à tenir** : un projet peut avoir une date de début et une date de fin, ou seulement une date de fin (une deadline). Tu peux aussi lui fixer un montant maximum à ne pas dépasser, qui se compare à ses dépenses, et un montant minimum à atteindre, qui se compare à ses entrées. La carte te dit combien de jours il reste et si tu tiens tes montants. La période ne trie aucune opération : elle sert de point de départ quand tu cherches des opérations à ajouter au projet.
- **Projets et Objectifs réunis** : les deux extensions n'en font plus qu'une, « Projets et objectifs », sur un seul onglet de la page Budget coupé en deux moitiés. Chacune garde son fonctionnement. Quand tu ouvres un projet ou un objectif, il prend toute la largeur. Si tu utilisais l'une des deux, la nouvelle est déjà activée.
- **Un graphe pour une catégorie, dans le temps** : sur la page Budget, sous la comparaison de deux périodes, « Une catégorie dans le temps » montre ce qu'une seule catégorie pèse, mois par mois sur l'année choisie, ou année par année. C'est le même calcul que l'histogramme du dashboard (amortissements, remboursables et découpes compris). Un mois où tu n'as aucune opération n'est pas affiché. Le sélecteur de catégorie est celui du dashboard, en choix unique.
- **L'import reconnaît l'export de ta banque** : Boursorama, N26, Revolut, PayPal, Crédit Agricole, Société Générale, Caisse d'Épargne, Fortuneo, Crédit Mutuel / CIC et La Banque Postale sont reconnus à leurs intitulés de colonnes, dans n'importe quel ordre. L'app te propose alors la bonne lecture, et tu vérifies l'aperçu avant d'importer. Une banque inconnue passe par la détection habituelle.
- **L'import propose tes catégories** : pour chaque catégorie de ta banque que l'app ne connaît pas encore, elle propose la tienne d'après le nom et des mots-clés (français, anglais et portugais du Brésil). Chaque catégorie a sa liste, modifiable dans son formulaire. Elle ne classe jamais rien sans ton accord, même quand elle est sûre.
- **Un tableau pour classer avec les opérations sous les yeux** : à la lecture d'un fichier, une fenêtre aligne une colonne par catégorie de ta banque, avec les opérations concernées. Tu choisis la catégorie à la molette (clique, ou ↑ ↓), puis tu confirmes avec le bouton ou Ctrl+Entrée : la colonne suivante prend le relais. Une fois confirmée, la correspondance est retenue pour ce format de fichier.
- **L'import se fait en étapes** : une fenêtre à la fois, avec un petit graphe qui montre où tu en es. D'abord ce que contient chaque colonne, puis, si le fichier a une colonne « Sens » ou « État », ce que veut dire chaque mot qu'il écrit (IN / OUT, COMPLETED / CANCELLED…), puis les catégories, et enfin le compte et les monnaies. Le compte vient en dernier, et le choisir ne défait rien de ce que tu as déjà confirmé.
- **Une détection plus fine des relevés à deux montants** : un montant envoyé et un montant reçu (Wise, Revolut…) sont reconnus ensemble, y compris d'après les devises, et les colonnes « Direction » et « Status » sont proposées d'emblée.
- **Une page d'import plus claire** : les correspondances restent repliées tant qu'il ne manque rien, « Le fichier tel qu'il est » se place sous le choix du fichier, et en fermant la dernière fenêtre tu arrives sur le contrôle avant import, juste au-dessus de « Confirmer l'import ».
- **Exporter tes données** : dans les paramètres généraux, un export de toutes les tables en JSON, en CSV (une archive avec un fichier par table) ou en Excel (une feuille par table). Ce sont des photographies pour lire ou garder tes données ailleurs : ces fichiers ne se réimportent pas.
- **Des copies de sécurité dans le dossier de ton choix** : indique un dossier (un autre disque, un dossier synchronisé, une clé) et l'app y range une copie complète de ta base au démarrage, puis au plus une fois par jour. Les 30 plus récentes sont gardées. Pour restaurer : Paramètres, Base de données, « Basculer sur ce fichier », et tu choisis la copie.

## À savoir avant de mettre à jour

- La base se met à jour toute seule au premier lancement. Si tu veux être tranquille, fais une copie du fichier avant.
- Les copies de sécurité sont désactivées tant que tu n'as pas choisi de dossier. Évite celui de l'application : une mise à jour le remplace.
- Pour les exports de banques, la reconnaissance se fait d'après les intitulés tels que les banques les écrivent aujourd'hui. Si l'une d'elles change son fichier, l'app retombe sur la détection habituelle.

---

**Première installation ?** Toute la procédure (Windows, macOS, Linux, extensions) est dans le [README](https://github.com/Lunebleue8932/budget-app#installation).
