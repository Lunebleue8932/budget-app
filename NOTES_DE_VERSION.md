# Virements internes mieux reconnus, titres repliables, et la langue qui reste

## Nouveautés

- **Un virement interne déjà en base est reconnu quand le relevé de l'autre compte arrive.** Même ancien, même saisi à la main, même si la ligne arrive classée en opération classique : l'app te demande « Même virement ? ». Oui : la ligne n'est pas importée, et elle est retenue pour que le relevé suivant la reconnaisse tout de suite. Non : elle est importée comme une opération à part. Annuler l'import d'un « Oui » ne supprime jamais le virement. L'import reste bloqué tant qu'un choix n'est pas fait, et « Tout valider » est là pour les relevés qui en comptent beaucoup.
- **Une seule détection parle par ligne, la plus sûre d'abord** : le doublon exact, puis la jambe en face identifiée, puis la ressemblance. Sur une ressemblance dont le virement existe déjà, un bouton « C'est le même virement » dit ce que l'app n'a pas su conclure seule.
- **Cette détection devient une extension, « Détection des ressemblances ».** Tant qu'elle est éteinte, l'import ne cherche plus ces rapprochements.
- **Les lignes refusées par la banque sont retenues comme doublons.** Quand ton relevé a une colonne « État », une ligne refusée ne sera jamais importée : aux imports suivants, elle tombe directement dans les doublons. Une ligne que tu retires toi-même de l'aperçu n'est pas retenue, tu pourras l'importer une autre fois.
- **L'aperçu d'import est réorganisé en titres repliables.** Les doublons sont séparés en deux (opérations classiques, virements internes), les possibles doublons de virements internes sont regroupés au-dessus des virements, et la colonne « Compte (banque) » disparaît quand ton preset n'en lit pas.
- **Les règles savent comparer le montant reçu et le montant envoyé, et leurs devises.** La valeur d'une condition peut être un nombre ou une formule (par exemple `montant_envoye * 1,02`). L'icône ƒ, à gauche du champ, propose les fonctions (max, min, et reste dans une découpe) et les grandeurs de la ligne.
- **Une ligne découpée par une règle montre son menu de découpage dans l'aperçu**, avec ses catégories et ses montants, et tu peux le corriger. Si tu choisis une catégorie à la place, la découpe est défaite : ton choix passe avant la règle.
- **Un objectif hebdomadaire a une troisième vue, « Moyenne de l'année »**, quand tu le regardes depuis un mois. Elle se calcule comme celle du mois, sur les semaines écoulées depuis le premier mois où il y a des dépenses.
- **Les projets ont leur cascade** : les entrées, puis chaque catégorie de dépense aux couleurs du dashboard, puis ce qu'il reste. Les colonnes suivent l'ordre de la page Opérations, et le sélecteur d'opérations filtre aussi par type et par catégorie.
- **Le montant à rembourser reste modifiable après une liaison**, sans jamais descendre sous ce qui est déjà remboursé. Le reste à rembourser se recalcule tout seul.
- **Ajouter une catégorie, un compte, une monnaie ou un taux de change** se fait dans des titres repliables : la page Configuration se lit plus facilement.
- **La langue est enregistrée dans la base**, comme la monnaie d'affichage par défaut, et la fenêtre de l'application garde son profil d'un lancement à l'autre.
- Une monnaie éteinte n'est plus proposée quand tu fais correspondre une devise à l'import, et une devise pas encore rattachée s'affiche sans devise, plutôt qu'avec celle d'une autre monnaie.
- Découper une opération propose d'abord sa catégorie. Après « Voir toutes les dépenses », « Réinitialiser » revient à la vue de base, et seul le nom choisi d'une liste de filtre est coloré.

## Corrections

- La langue choisie ne se retenait pas d'un lancement à l'autre : elle est maintenant enregistrée dans la base.
- Une opération découpée n'apparaissait pas quand tu filtrais sur l'une de ses catégories : elle remonte dès qu'une de ses parts correspond.
- Enregistrer un autre champ d'une ligne découpée par une règle défaisait sa découpe : ce n'est plus le cas.

## À savoir avant de mettre à jour

- **Une mise à jour de la base se fait toute seule au premier lancement** (migration 0074), après une copie de sécurité de ta base. Rien à faire de ton côté.
- **L'extension « Détection des ressemblances » est à activer** dans Paramètres → Extensions pour profiter de la jambe en face identifiée et des ressemblances.

---

**Première installation ?** Toute la procédure (Windows, macOS, Linux, extensions) est dans le [README](https://github.com/Lunebleue8932/budget-app#installation).
