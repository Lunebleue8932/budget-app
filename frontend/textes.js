/* ---------- LES INDICATIONS TEXTUELLES DE L'APPLICATION ----------
 *
 * CE FICHIER EST LA SOURCE, PAS UNE COPIE. Chaque phrase d'aide de
 * l'application n'existe qu'ICI : le HTML ne porte plus que la clé
 * (`data-info-cle="noyau.total-depenses"`), et `appliquerTextes` va chercher le
 * texte au chargement. Réécrire une entrée de ce fichier suffit donc à changer
 * ce qui s'affiche — il n'y a aucun second endroit à mettre d'accord, et rien
 * ne peut diverger en silence.
 *
 * POURQUOI PAS UNE TABLE EN BASE. Ces phrases ne sont pas des données : elles
 * ne varient pas d'un utilisateur à l'autre, elles n'ont pas d'historique, et
 * elles doivent être présentes AVANT le premier appel réseau — l'infobulle d'un
 * écran vide est justement celle qui explique pourquoi il est vide. Un fichier
 * se relit, se compare d'une version à l'autre et se corrige dans l'éditeur ;
 * une table aurait demandé une migration pour chaque virgule.
 *
 * CE QU'ON Y TROUVE, et ce qu'on n'y trouve pas :
 *
 *   - OUI : le texte des pastilles « i » (`data-info-cle`) et les blocs d'aide
 *     repliés ou permanents du HTML (`data-texte-cle`). Autrement dit, tout ce
 *     qui EXPLIQUE l'application à celui qui la lit.
 *   - NON : les libellés de boutons, de colonnes et de champs. Ils ne se
 *     réécrivent pas, ils se renomment — et renommer un bouton sans toucher au
 *     code qui le cherche par son identifiant est une autre opération. Ils
 *     restent dans index.html, où ils se lisent en même temps que la structure
 *     qu'ils nomment.
 *   - NON : les messages d'erreur du serveur, qui viennent du backend et
 *     passent par `traduireMessageServeur` (cf. i18n.js).
 *
 * LA TRADUCTION PASSE APRÈS. `appliquerTextes` pose le français, puis
 * `traduireDomStatique` le remplace par l'anglais s'il y a lieu — c'est donc
 * toujours la phrase FRANÇAISE d'ici qui sert de clé au dictionnaire i18n.
 * Réécrire une entrée de ce fichier sans toucher à `i18n.js` fait donc
 * simplement retomber l'anglais sur le français, jamais disparaître le texte.
 *
 * LES CLÉS SONT `<espace>.<nom>`. L'espace est « noyau » ou l'identifiant de
 * l'extension ; le nom décrit ce que la pastille annote. Deux endroits qui
 * affichaient exactement la même phrase PARTAGENT la même clé — c'est
 * volontaire, et c'est la moitié de l'intérêt du fichier : la réécrire une fois
 * la corrige partout.
 */

const TEXTES = {
  /* ----- Paramètres généraux ----- */
  "noyau.touche-gel-infobulle":
    "La touche permettant de geler l'infobulle sur les graphiques. Pour la changer, clique sur le champ et saisis la nouvelle touche ou combinaison de touches",

  /* ----- Le camembert et ses deux vues ----- */
  "noyau.camembert-vue-budget":
    "La répartition de tes dépenses rapportées à ton budget de la période.",

  /* ----- L'application elle-même (index.html) ----- */
  "noyau.reste-a-rembourser":
    "Ce qu'on te doit - Ce que tu dois.",
  "noyau.total-entrees":
    "Les entrées d'argent - prévisionnelles incluses - attribuées à la période (différent de ce qui rentre sur ton compte durant la période). Les entrées amorties sont comptées au prorata, et les dépenses remboursables ne comptent que pour la part non-remboursable.",
  "noyau.total-depenses":
    "Les sorties d'argent - prévisionnelles incluses - attribuées à la période (différent de ce qui sort de ton compte durant la période). Les dépenses amorties sont comptées au prorata. Les prêts ne comptent que pour la partie à rembourser.",
  "noyau.variation-attribuee-au-mois":
    "La différence des deux KPIs différents.",
  "noyau.variation-sur-le-mois-brute":
    "La variation de ce que tu possèdes sur le mois : un calcul brut en fonction de la date et du montant.",
  "noyau.statut-previsionnel":
    "Pour les opérations à venir qui n'ont pas encore eu lieu. Elles comptent pour ton solde projeté et dans les graphiques du dashboard - de manière distincte.",
  "noyau.notes":
    "Un pense-bête, non lu par l'app. Ça s'enregistre tout seul.",
  "noyau.repartition-des-avoirs":
    "La répartition des avoirs en fonction du type de comptes - prends en compte la valorisation des titres possédés.",
  "noyau.montant-min":
    "Montant brut, sans le signe. Ne rien mettre n'impose pas de borne.",
  "noyau.frais":
    "Les frais sur ton opération. Ils apparaissent séparément pour pouvoir les distinguer, mais c'est bien le montant + les frais (ou - les frais) qui sont utilisés pour les calculs.",
  "noyau.monnaie-des-frais":
    "Utile pour les virements internes entre devises différentes. Elle permet à l'app de comprendre si elle doit soustraire ou additioner les frais - et où.",
  "noyau.decouper-entre-plusieurs-categories":
    "Pour répartir le montant d'une opération en plusieurs catégories.",
  "noyau.amortie-sur-plusieurs-mois":
    "Permet d'amortir la dépense sur plusieurs mois, pour avoir une meilleure vue de tes dépenses. N'affecte pas le solde de ton compte et ne change pas la date de l'opération.",
  /* ----- La notice d'utilisation -----
     CES PHRASES SONT AUSSI CELLES DES ÉCRANS. La notice n'en écrit de
     nouvelles que pour ce qu'aucune pastille « i » ne dit déjà : partout
     ailleurs elle emploie les MÊMES clés que la page qu'elle décrit (cf. les
     `data-texte-cle` de la section #section-notice). C'est ce qui l'empêche de
     décrire une application qui n'existe plus. */
  "noyau.notice-intro":
    "Le mode d'emploi de l'application. Il est assez dense, mais n'a pas vocation à être lu d'un coup. Il s'agit pluôt d'un guide à consulter si tu te poses des questions.",
  "noyau.notice-mot-compte":
    "C'est la première brique pour catégoriser tes opérations : affecter une opération à un compte impactera son solde, et pas celui des autres.",
  "noyau.notice-mot-operation":
    "Une ligne : une date, un libellé, un montant, un compte. C'est la base sur laquelle repose le reste de l'application.",
  "noyau.notice-mot-categorie":
    "C'est la seconde brique pour catégoriser une opération, qui vient avec des valeurs par défaut (modifiables et supprimables) : alimentation, transports, loisirs. C'est avec elles que les graphiques du dashboard se construisent.",
  "noyau.notice-mot-monnaie":
    "L'application permet de prendre en compte plusieurs devises avec l'extension « Monnaies », pour ne pas mélanger ce qui ne devrait pas l'être.",
  "noyau.notice-demarrer-1":
    "Crée ton ou tes comptes (dans Paramètres → Comptes /Paramètres/Comptes), en choissisant leur type (Courant, d'épargne ou de placements) et leur solde de départ.",
  "noyau.notice-demarrer-2":
    "Réorganise tes catégories, dans Paramètres → Catégories /Paramètres/Catégories. Tu peux librement en créer, supprimer et modifier, dont les 4 de base.",
  "noyau.notice-demarrer-3":
    "Créer tes opérations : à la main dans la page Opérations /Opérations, ou par un import de relevé (cf. Importer un relevé /Importer un relevé)",
  "noyau.notice-demarrer-4":
    "Ensuite, direction le dashboard ! /- En haut, une vue globale de tes avoirs. /- Au milieu, des cartes qui décrivent l'évolution de ton compte sur le mois ou l'année. /- En bas, deux graphiques te permettant de comprendre ta répartition. // Et enfin, un champ libre de notes (qui s'enregistre automatiquement).",
  "noyau.notice-donnees":
    "Toutes tes données vivent dans un fichier, dont tu dois choisir l'emplacement au premier lancement. Tu peux le déplacer via Paramètres → Base de données /Paramètres/Base de données. Aucune copie n'est faite et rien ne sort de ton PC : fais donc attention à ne pas le supprimer par erreur.",
  "noyau.notice-dashboard-intro":
    "Le dashboard répond à deux questions différentes : qu'est-ce que tu as aujourd'hui (cartes en haut) et comment ce que tu as a évolué (cartes en-dessous) sur la période choisie.",
  "noyau.notice-kpi-solde-total":
    "Le total de tes comptes courants. Le chiffre en plus est le prévisionnel, il prend en compte les opérations prévisionelles (cf. Les types d'opérations /Les types d'opérations).",
  "noyau.notice-kpi-avoirs":
    "Ce KPI regroupe tout ce que tu possèdes : comptes courants, épargne, et la valeur de tes titres côtés si l'extension « Placements financiers » tourne.",
  "noyau.notice-dashboard-ecart":
    "Deux KPIs pour deux manières de calculer des variations sur le mois : l'une dit ce que le mois COÛTE - les dépenses que tu as attribuées à ce mois - et l'autre ce qui est PASSÉ sur ton compte sur ce mois. /- Par exemple, tu peux payer pour un abonnement annuel et vouloir le faire compter sur chaque mois au lieu d'un seul dans l'année (c'est la fonctionnalité d'amortissement /Les types d'opérations). /- Tu peux aussi avoir une dépense à faire rembourser (en partie ou en totalité) : le premier KPI prendra en compte ce que tu as dépense - ce qu'on te doît, l'autre fera abstraction de cette deuxième donnée. // Quand elles diffèrent, un bouton apparaît et te permet de voir plus en détails.",
  "noyau.notice-graphes":
    "Les deux graphes montrent la répartition de tes dépenses en fonction de la catégorie. Tu pilotes l'affichage avec la période du sélecteur et avec le filtre « Catégories ». Survoler une barre, une tranche ou une ligne de légende ouvre une infobulle avec plus de détails : /- Le total de la catégorie /- Le poids en pourcentage de celle-ci /- Ton top 3 dépenses (agrégées selon le nom : si tu fais 5 fois des courses au même endroit, tu verras une ligne avec le total et un (5)). /- Enfin, tes objectifs de budget s'y affichent si tu as activé l'extension.",
  "noyau.notice-graphes-histogramme":
    "L'histogramme affiche le total par catégorie ! Si tu as l'extension « Budget », la barre rouge qui apparaît est le budget que tu t'es fixé.",
  "noyau.notice-graphes-camembert":
    "Le camembert montre la part de chaque catégorie. / -En vue « État actuel », chaque tranche est rapportée au total dépensé (le total fait donc 100%). /- En vue « Budget », elles sont rapportées au budget du mois : l'anneau reste ouvert sur ce qui n'a pas été dépensé.",
  "noyau.notice-graphes-legende":
    "La légende sous les deux est commune aux deux graphiques : l'infobulle affiche le bouton « Voir toutes les dépenses » qui t'emmène à la liste des opérations de cette catégorie.",
  "noyau.notice-graphes-semaines":
    "La flèche sous la rangée des mois déplie les semaines : l'histogramme devient celui de la semaine choisie, et « Moyenne » te montre une vue moyennée sur le mois (au prorata en fonction du nombre de jours écoulés). Les cartes ne sont pas affectées.",
  "noyau.notice-types-intro":
    "Le type d'une opération te permet de dicter comment elle agit. Deux types sont disponibles de base, les opérations classiques (entrées et sorties d'argent) et les virements internes (entre deux comptes que tu possèdes). Les autres sont activables et utilisables grâce à des extensions.",
  "noyau.notice-type-classique":
    "Le type d'opération par défaut et le plus courant : des courses, un paiement, un salaire, etc... C'est le seul type que tu peux découper en plusieurs catégories (plus de détails en bas de page).",
  "noyau.notice-type-virement":
    "Les virements internes ne font pas bouger combien tu possèdes. Ils ont leur type à part, et ne rentrent pas dans les calculs de tes KPIs (à l'exception des virements internes entre deux monnaies différentes).",
  "noyau.notice-type-remboursable":
    "Si tu as avancé de l'argent ou qu'une de tes dépenses est remboursable, ce type est fait pour ton opération. Il te permet de /- ne compter que combien tu as réellement dépensé dans tes KPIs et les graphiques /- renseigner un montant dû /- suivre combien on te doit // Quand un remboursement est effectué (en partie ou totalement), le type Remboursement reçu te permet de relier l'opération de remboursement à la dépense remboursable.",
  "noyau.notice-type-pret":
    "Ce type est similaire au précédent, mais dans la situation inverse. Ici, seul les intérêts du montant prêté (s'il y en a) rentrent dans le compte des dépenses.",
  "noyau.notice-type-action":
    "L'achat ou la vente d'un titre. Tu ne le saisis jamais depuis la page Opérations : il naît avec sa ligne dans l'écran des placements, et le mouvement d'espèces sur le compte-titres en découle.",
  "noyau.notice-types-extensions":
    "D'autres types existent et n'apparaissent qu'avec l'extension qui les ouvre : dépenses remboursables, prêts reçus, opérations sur titres. Va voir Paramètres → Extensions pour savoir ce que tu as sous la main.",
  "noyau.notice-statut":
    "Deux possibilités pour une opération, réelle ou prévisionnelle :/- les dépenses réelles (la plupart des opérations) sont celles qui ont eu lieu /- les dépenses prévisionnelles sont celles que tu anticipes. A l'import de l'opération en question, l'app le détecte et te propose de remplacer l'opération prévisionnelle.",
  "noyau.notice-import-intro":
    "L'import, c'est la manière la plus simple de mettre l'app à jour sur ton budget. Tu peux créer des preset d'imports et des règles /Les extensions/Règles de catégorisation pour configurer une fois ton système d'importation. Les fois d'après, il ne suffira que de quelques clics pour importer.",
  "noyau.notice-tutoriel-encart":
    "Un relevé d'exemple au format CSV est disponible te permettre de visualiser. Il contient deux lignes de titre (à ne pas lire) trois colonnes inutiles pour l'app.",
  "noyau.notice-exemple-colonnes":
    "A SUPPRIMER",
  "noyau.notice-import-etape-1":
    "Choisis ou crée le PRESET qui correspond à ton fichier, et sélectionne de quel compte il s'agit.",
  "noyau.notice-import-etape-2":
    "Dépose le fichier. L'application le lit et affiche comment elle le lit actuellement.",
  "noyau.notice-import-etape-3":
    "Corrige la lecture si besoin : glisse les en-têtes pour remettre chaque propriété en face de la bonne colonne, dis combien de lignes de tête sauter, puis enregistre la configuration dans le preset.",
  "noyau.notice-import-etape-4":
    "Remplis les correspondances entre catégories, monnaies ou banques de ton relevé et ceux de l'app. L'app les garde en mémoire pour que tu n'aies pas à les renseigner à nouveau.",
  "noyau.notice-import-etape-5":
    "Confirmer te permet de finaliser ! Si tu souhaites revenir en arrière, tu peux annuler l'import : tout revient alors précisément à l'état précédent.",
  "noyau.notice-import-annuler":
    "A SUPPRIMER",
  "noyau.notice-extensions-intro":
    "L'application est par défaut minimaliste. Une fois familiarisé, choisis les extensions qui t'intéressent et te sont utiles à ta guise.",
  "noyau.notice-extensions-eteindre":
    "Éteindre une extension ne supprime AUCUNE donnée : seul l'affichage disparaît.",

  /* ----- Extension « Budget » -----
     L'espace de noms reste `analyse-budget`, l'identifiant du DOSSIER : c'est
     lui que porte `data-info-cle`, et il ne s'affiche nulle part. */
  "analyse-budget.graphes":
    "« Comparer avec » te permet de comparer deux périodes de même durée.",
  "analyse-budget.budget-total":

    "Le budget de chaque mois, il reprend la valeur du dernier mois par défaut. Il relie les objectifs par catégorie en pourcentage et en valeur. ",
  "analyse-budget.budget-total-aide":
    "Mois par mois et monnaie par monnaie. Hérite par défaut des valeurs du mois précédent.",
  "analyse-budget.budgets-categories":
    "Une valeur par catégorie, lue de deux façons. -- LE CURSEUR répartit ; les deux cases à sa droite montrent la même enveloppe en monnaie et en part du budget du mois. Bouger le curseur met les deux à jour. -- ÉCRIRE DANS L'UNE recalcule l'autre et replace le curseur. Ctrl+Entrée, ou un clic ailleurs, enregistre. -- L'ENVELOPPE répond à « combien puis-je encore dépenser là » : c'est elle que trace le trait rouge de l'histogramme du dashboard. La PART répond à « quelle portion de mon budget y va » : c'est elle que le camembert affiche en vue Budget. -- La somme des parts ne peut pas dépasser 100 %, donc la somme des enveloppes ne peut pas dépasser le budget du mois. Au-delà, la saisie est refusée et le message dit le plafond utilisable. -- Sans budget du mois posé, la case des parts n'a pas de dénominateur : elle reste éteinte, et seule l'enveloppe s'enregistre.",
  "analyse-budget.epargne":
    "La différence entre ce qui entre et ce qui sort de tes comptes d'épargne ou de placements. Un bon indicateur à suivre si tu veux mettre de l'argent de côté régulièrement.",
  "analyse-budget.matelas":
    "Le matelas de sécurité que tu gardes sur tes comptes d'épargne - les comptes de placements ne rentrent pas dans ce scope.",
  "analyse-budget.matelas-aide":
    "Les comptes d'ÉPARGNE seulement, et leur solde réel. Un compte de placements porte des titres, qui ne sont disponibles qu'après une vente, à un cours qu'on ne connaît pas d'avance : les compter dans un matelas de sécurité reviendrait à se rassurer avec de l'argent qu'on n'a pas encore. Laisse à zéro pour ne pas poser de seuil du tout.",
  "analyse-budget.imprevues":
    "Les dépenses que tu n'avais prévues : une vue globale te permet de mieux comprendre comment elles pèsent dans ton budget.",
  "analyse-budget.imprevues-aide":
    "Tooltip à SUPPRIMER",
  "analyse-budget.imprevue-champ":
    "Une étiquette lue par l'extension budget. Elle te permet d'avoir une vue globale de tes dépenses liées à des imprévus.",

  /* ----- Rapprocher une prévisionnelle de la vraie ----- */
  "noyau.import-previsionnelles":
    "Ces lignes du relevé correspondent à des dépenses que tu avais écrites d'avance, en prévisionnel. Plutôt que d'ajouter une opération de plus à côté de la prévision, l'import va REMPLACER la prévision par la vraie ligne : même opération, désormais réelle, avec la date et le montant du relevé. Elle garde tout ce qui lui était rattaché — son projet, son profil de remboursement, sa récurrence. Coché, le remplacement a lieu ; décoché, la ligne s'importe comme une autre et la dépense prévue reste telle quelle. Vérifie la colonne de droite avant de confirmer : c'est elle qui dit ce qui sera écrasé. Et si tu te trompes, annuler l'import rend chaque prévision à son état d'origine.",
  "noyau.rapprochement":
    "Permet l'amélioration de la détection d'une dépense prévisionnelle renseignée dans l'app lors de son importation. L'import te proposera alors de valider la substitution.",
  "noyau.rapprochement-mots-cles":
    "Permet de ne pas confondre des dépenses de même montant, compte et date mais dont le libellé est différent.",

  "noyau.montant-a-rembourser":
    "Combien on te doit sur une dépense remboursable, combien tu dois sur un prêt.",
  "noyau.notes-2":
    "Un commentaire non lu par l'app. Sur un virement, il vaut pour les deux comptes.",
  "noyau.comptes":
    "Double-clique une ligne pour modifier un compte, fais-la glisser d'une carte à l'autre pour changer son type.",
  "noyau.monnaies-du-compte":
    "Chaque monnaie du compte garde son propre solde, non mélangé aux autres.",
  "noyau.categories-de-depenses":
    "Les dépenses se rangent dans ces catégories. Les réordonner change l'ordre d'apparition sur le dashboard. Eteindre une catégorie agit comme si elle n'existait plus à partir de l'extinction, tout en la conservant comme la catégorie des dépenses à laquelle elle est attribuée.",
  "noyau.categorie-entree":
    "Te permet de marquer des catégories comme étant des entrées d'argent. Elles n'apparaissent pas sur l'histogramme et ne portent pas de budget.",
  "noyau.correspondances-memorisees":
    "Les correspondances - catégories, comptes bancaires, monnaies - que l'app a mémorisé de tes imports",
  "noyau.categories-bancaires":
    "Le libellé de ton relevé, suivi du compte lié au preset d'importation. Glisse-le vers une autre catégorie pour modifier la correspondance.",
  "noyau.comptes-bancaires":
    "Les noms de compte lus dans tes relevés et le comptes de l'app en face.",
  "noyau.devises":
    "Les libellés de devise de tes relevés (« EUR »), et la monnaie de l'app en face.",
  "noyau.preset":
    "Comment l'app doit comprendre ton fichier d'opérations.",
  "noyau.compte-bancaire-de-ce-preset":
    "Toutes les lignes du fichier iront sur ce compte. Laisse « aucun » si le fichier comporte une colonne comptes.",
  "noyau.configuration-du-fichier":
    "Quelle colonne de ton fichier porte quelle information. Date, Nature et Montant sont obligatoires.",
  "noyau.colonnes-lues":
    "Clique sur l'œil pour indiquer à l'app de lire ou d'ignorer une information.",
  "noyau.configuration-avancee":
    "Pour les fichiers nécessitant un paramétrage plus complexe.",
  "noyau.reglages-de-lecture":
    "À régler seulement si le fichier est mal lu : colonnes mélangées, montants illisibles. L'app devine seule dans la plupart des cas.",
  "noyau.detection-colonnes":
    "L'application lit le fichier et essaie d'attribuer chaque colonne à une ou plusieurs potentielles propriétés. Ensuite, à toi de trancher. Rien n'est enregistré sur ton preset tant que tu n'utilises pas le bouton d'enregistrement ou d'actualisation.",
  "noyau.detection-colonnes-enregistrer":
    "Appliquer met à jour les colonnes, sans enregistrer le preset. Attention : si tu appuies sur Enregistrer le preset, ton ancien preset sera remplacé par la configuration actuelle.",
  "noyau.detection-colonnes-suggestion":
    "La plupart des lignes sont illisibles, tu peux utiliser la détectection automatique de colonnes pour t'aider à régler ce souci.",
  "noyau.le-fichier-tel-qu-il-est":
    "Les colonnes lues sont colorées et portent l'information que l'app en tire en en-tête. Deux façons de modifier : glisser un en-tête sur un autre pour échanger les deux ou saisir les numéros dans « Configuration du fichier » au-dessus.",
  "noyau.categories-bancaires-a-confirmer":
    "Les nouveaux libellés apparaîtront ici, pour que tu renseignes vers quelle catégorie de l'app ils pointent. Une fois fait, confirme en cochant la case.",
  "noyau.apercu-import":
    "Les doublons repérés sont déjà cochés pour permettre une suppression rapide. Pour déverrouiller l'import, supprime-les ou décoche-les si tu veux tout de même les importer.",
  "noyau.ressemblances":
    "Une détection de doublons pour les virements internes : les opérations ici ne sont pas rejetés par défaut, mais l'app te les signale pour éviter d'importer des opérations en double.",
  "noyau.doublons-detectes":
    "Ces lignes sont identiques à des lignes déjà importées, sur la base des critères que tu as défini pour le preset. Tu peux les importer en les décochant.",
  "noyau.lignes-entete":
    "Les lignes d'en-tête et d'informations qui ne sont pas des opérations. N'utilise pas ceci pour gérer des doublons, une fonctionnalité est présente pour ça.",
  "noyau.comparaison-des-doublons":
    "Quelles colonnes l'app doit lire ou non pour identifier un doublon.",
  "noyau.mots-cles-de-la-colonne-sens":
    "Les mots-clés indiquant si ligne sort ou entre. Ajoute-les un par un avec « + » ou Entrée ; insensible aux majuscules et accents.",
  "noyau.mots-cles-de-la-colonne-etat":
    "Les mots-clés indiquant l'état de l'opération : utile si ton fichier renseigne des status (ex : en attente, complété, annulé).",
  "noyau.devises-a-faire-correspondre":
    "Même fonctionnement que pour les catégories : enregistre la correspondance une fois pour toutes.",
  "noyau.devises-deja-rattachees":
    "Ces libellés ont déjà leur correspondance : simplement là pour vérifier avant de confirmer.",
  "noyau.historique-des-importations":
    "Annuler un import retire les opérations qu'il avait créées, qu'elles aient été modifiées ou non.",
  "noyau.extensions":
    "Une extension ajoute une fonctionnalité. La désactiver fait disparaître son écran sans rien effacer — tout revient si tu la rallumes.",
  "noyau.base-de-donnees":
    "L'application lit et écrit dans un seul fichier .db. « Basculer » permet de lire un fichier différent. « Créer / déplacer ici » déplace la base actuelle dans le nouveau dossier.",

  /* ----- Extension « Import de placements » ----- */
  "import-placements.format-du-fichier":
    "Un preset par courtier : colonnes à lire et vocabulaire de ses relevés. Ceux des relevés bancaires vivent à part, sur la page Import.",
  "import-placements.compte-de-placements-de-ce-preset":
    "Un relevé de courtier ne dit jamais quel compte il décrit. Le lier ici évite de le choisir à chaque import ; laisse vide si plusieurs comptes ont le même format.",
  "import-placements.colonnes-lues":
    "Clique sur l'œil pour lire ou ignorer une colonne. Les colonnes proposées dépendent de ce que le fichier contient : une liste d'opérations lit une date et un type, une photographie lit une quantité détenue et un prix de revient.",
  "import-placements.le-fichier-contient":
    "Une liste d'opérations rejoue l'histoire du compte : une ligne par achat, vente ou transfert, chacune datée. Une photographie dit ce que tu détiens aujourd'hui : une ligne par titre, sa quantité, son prix de revient. La photographie évite de réimporter dix ans de mouvements.",
  "import-placements.mots-cles-de-la-colonne-type-d-operation":
    "Les mots que ton courtier emploie pour dire achat, vente ou mouvement d'espèces. Ajoute-les un par un avec « + » ou Entrée ; majuscules, accents et espaces sont ignorés. Une liste vide retombe sur les mots par défaut, un libellé inconnu met la ligne en erreur.",
  "import-placements.comparaison-des-doublons":
    "Comment l'app reconnaît une ligne déjà importée sous ce preset. Soit toutes les colonnes moins celles qui bougent d'un export à l'autre (numéro d'ordre, solde courant), soit les seules qui identifient une ligne — souvent date + valeur + montant + quantité.",
  "import-placements.date-de-la-photographie":
    "Le jour où la photographie a été prise : c'est de cette date que l'app te considère détenteur de ces titres. Aujourd'hui par défaut.",
  "import-placements.titres-qui-seront-crees":
    "L'app ne connaît pas encore ces valeurs et les créera à l'import. Si l'une existe déjà chez toi sous un autre nom, choisis-la à la main sur sa ligne.",
  "import-placements.regles-de-type-d-operation":
    "Une règle reconnaît une ligne à son libellé et dit ce qu'elle est : achat, vente, transfert d'espèces. Elle vaut pour tous tes courtiers et passe avant les mots-clés du preset. Les mots-clés de la « Configuration du fichier » comparent un libellé entier : « Achat » est un achat, et rien d'autre ne l'est. Quand le courtier écrit une phrase — « ACHAT COMPTANT ETF MSCI WORLD », avec le nom du titre dedans — aucune liste de mots-clés ne peut la reconnaître, parce qu'il n'y a pas deux fois le même libellé dans le fichier. Une règle, elle, sait dire « contient ACHAT ». Elles sont évaluées de haut en bas et s'arrêtent à la première qui correspond : contrairement aux règles bancaires, une règle de placement ne décide que d'une chose, il n'y a donc rien à compléter en dessous. Place les cas particuliers au-dessus des cas généraux. Une ligne qu'aucune règle ne reconnaît retombe sur les mots-clés du preset. Sans aucune règle, l'import se comporte donc exactement comme avant.",
  "import-placements.description":
    "Note libre : pourquoi cette règle existe, quel relevé l'a rendue nécessaire. Jamais lue par l'application.",
  "import-placements.avec-le-compte-en-face":
    "L'autre compte : celui d'où vient l'argent versé, ou celui où va l'argent retiré. Le sens se déduit du signe du montant. Sans lui, la ligne est à compléter à la main dans l'aperçu.",
  "import-placements.et-type-le-titre-en":
    "Une étiquette posée sur le titre que la ligne désigne — ETF, obligation, action. Uniquement à la création d'un titre : un titre déjà typé garde le sien. Purement descriptif.",

  /* ----- Extension « Intérêts perçus » ----- */
  "interets-percus.interets-percus":
    "Pour renseigner les intérêts perçus sur tes comptes de placements. Pense à les remettre à 0 si un import de relevé les importe.",

  /* ----- Extension « Vue d'ensemble des placements » ----- */
  "investing-overview.repartition-par-classe":
    "À quoi ton portefeuille est exposé : actions, obligations, immobilier, monétaire ?",
  "investing-overview.repartition-par-type-de-titre":
    "Comment ton portefeuille est détenu : quelles sont les enveloppes que tu utilises ?",

  /* ----- Extension « Monnaies » ----- */
  "monnaies.monnaies":
    "Tooltip à SUPPRIMER",
  "monnaies.taux-de-change":
    "Permet d'utiliser la fonctionnalité tout convertir du dashboard pour une vue complète. Tes opérations ne sont jamais modifiées, uniquement l'affichage du dashboard.",

  /* ----- Extension « Placements » ----- */
  "placements.titres-suivis":
    "Les titres que tu utilises sur l'app. Le cours se saisit à la main ou se lit en ligne avec l'extension Lecture de cours.",
  "placements.afficher-les-titres-archives":
    "Tooltip à SUPPRIMER",
  "placements.enveloppe":
    "Voir l'infobulle plus bas.",
  "placements.classe-actif":
    "Voir l'infobulle plus bas.",
  "placements.types-de-titre":
    "Sous quelle forme tes titres sont détenus : ETF, action en direct, fonds et SCPI sont livrés par défaut.",
  "placements.classes-actif":
    "À quel type d'objet financier tes avoirs t'exposent-ils ?",

  /* ----- Extension « Objectifs » ----- */
  "objectifs.objectifs":
    "Les objectifs te permettent de te fixer des cibles et les visualiser concrètement.",
  "objectifs.perimetre":
    "Sur quoi porte l'objectif. -- Toutes les dépenses : tout ce qui sort, tous postes confondus. -- Une catégorie : elle classe une dépense par nature, et une dépense n'en a qu'une. -- Un projet : il regroupe par événement (un voyage, des travaux), à travers les catégories et les comptes. Une dépense peut appartenir à plusieurs projets. -- Une catégorie ou un projet, jamais les deux : les deux axes se croisent, et l'hôtel d'un voyage est à la fois dans « Loisirs » et dans « Italie ».",
  "objectifs.avec-cible":
    "Un objectif peut n'avoir aucune cible : il se contente alors d'afficher son chiffre sous les graphes du dashboard, sans dire s'il est tenu ou manqué. -- C'est le cas ordinaire d'un projet en cours : on veut voir ce qu'il coûte bien avant de savoir ce qu'on s'autorise. -- Attention, une cible à zéro n'est pas « pas de cible » : c'est une règle, et une règle sévère (« rien du tout ce mois-ci »).",
  "objectifs.mesure":
    "Quatre objectifs, deux manières de calculer. Montant total et part des dépenses fonctionnent comme les graphiques. Nombre de dépenses et montant moyen font abstraction des règles comme l'amortissement.",
  "objectifs.cadence":
    "Te permet de régler la plage temporelle que couvre l'objectif. -- Si tu indiques mois et que le dashboard est sur la vue mois, tu vois le total. -- Si tu indiques mois et que le dashboard est en vue année, tu verras la moyenne sur tous les mois existants.",
  "objectifs.visible-dashboard":
    "Les objectifs cochés s'affichent sous les graphes du dashboard, sur la période et la monnaie que tu y regardes. Les autres restent ici. C'est devant tes dépenses du mois qu'on se demande si on tient sa règle — mais un bloc qui grandit sans fin finirait par repousser les graphes hors de l'écran.",
  "objectifs.filtres":
    "Des conditions que chaque dépense doit remplir pour être comptée : un montant minimum ou maximum, un mot présent ou absent du libellé, les jours de semaine ou le week-end. -- Toutes s'appliquent ensemble. -- Un objectif filtré compte les dépenses ligne par ligne : une dépense amortie y pèse entièrement sur le mois où elle a été faite.",
  "objectifs.dashboard":
    "Ce que tu t'es fixé, mesuré sur la période affichée ci-dessus et dans la monnaie de l'onglet. Le grand chiffre est ramené à la cadence de l'objectif ; la ligne du dessous dit ce qui a servi à le calculer. Rien ici n'influe sur tes soldes ni sur tes graphes : un objectif regarde, il ne change aucun montant. Ils se créent et se modifient dans Budget → Objectifs.",

  /* ----- Extension « Projets » ----- */
  "projets.projets":
    "Rassemble des opérations déjà saisies, quelles que soient leur catégorie et leur compte, pour lire ce qu'un voyage ou un déménagement t'a coûté. Une opération peut appartenir à plusieurs projets, et rien d'autre dans l'app n'en tient compte. Un projet ne se saisit pas depuis une opération : on le crée ici, puis on y verse les opérations concernées. C'est un regroupement de LECTURE — retirer une opération d'un projet ne la supprime pas, et supprimer un projet ne supprime aucune dépense.",
  "projets.repartition-par-categorie":
    "Les sorties du projet, réparties par catégorie — virements sortants compris, comme dans le total ci-dessus. Les entrées n'y figurent pas : elles se lisent dans le total des entrées.",
  "projets.ajouter-des-operations":
    "Ajouter une opération ici ne la retire d'aucun autre projet, et ne change ni sa catégorie ni son compte.",

  /* ----- Extension « Règles » ----- */
  "regles.regles-de-categorisation":
    "Une règle reconnaît des lignes à leur libellé et dit ce qu'elles sont : virement interne, prêt, dépense remboursable… Elle peut aussi poser la catégorie, et passe avant tout le reste. Une règle classe automatiquement les lignes importées d'après leurs libellés — c'est le seul moyen de marquer une ligne « remboursable » ou de la classer en Prêt / Remboursement sans le faire à la main. Les règles sont communes à tous les presets d'import. Elles sont évaluées de haut en bas, et s'arrêtent à la première qui correspond — sauf si celle-ci décoche « Arrêter la lecture des règles ici ». Plusieurs règles peuvent alors s'appliquer à une même ligne, mais aucune ne défait ce qu'une règle plus haute a décidé : en cas de désaccord, la plus haute gagne. Place les cas particuliers au-dessus des cas généraux. Les règles passent avant les correspondances mémorisées : un type reconnu ici ne peut plus être défait par une correspondance de catégorie. Les dossiers ne servent qu'à s'y retrouver : ils ne changent pas l'ordre d'évaluation, qui reste celui de la vue liste (le numéro sur chaque carte le rappelle). Fais glisser une règle d'un dossier à l'autre pour la ranger. Ce classement reste sur cet ordinateur — il n'est pas enregistré dans la base.",
  "regles.description":
    "Note libre : pourquoi cette règle existe, quel relevé l'a rendue nécessaire, ce qu'il faudra vérifier si elle cesse de mordre. Jamais lue par l'application.",
  "regles.decouper-entre-plusieurs-categories":
    "La règle répartit le montant de la ligne entre plusieurs catégories, au lieu d'en poser une seule. Réservé aux opérations classiques.",
  "regles.avec-le-compte-en-face":
    "L'autre compte du virement, celui que le relevé ne nomme pas. Le sens se déduit du signe du montant. Sans lui, la ligne est à compléter à la main dans l'aperçu.",
  "regles.arreter-la-lecture-des-regles-ici":
    "Coché, le réglage habituel : cette règle décide, on s'arrête là. Décoché, les règles suivantes peuvent compléter ce qu'elle laisse ouvert — la catégorie, le compte en face. Le type reste celui de la première règle qui a mordu.",
  "regles.autres-proprietes":
    "Tout ce qu'une règle peut changer d'autre sur la ligne, sauf ses montants et sa date. Chaque champ est facultatif : laissé vide, la règle n'en dit rien. Le nouveau nom ne change pas ce que les règles comparent — elles lisent toutes le libellé du relevé.",
  "regles.sorties-conditionnelles":
    "La règle détecte une fois, et peut agir de plusieurs façons selon la ligne. Chaque sortie a ses propres conditions : la première qui correspond remplace les actions de la règle qu'elle renseigne, les champs laissés vides gardent celles de la règle. Aucune ne correspond : la règle agit telle quelle. Exemple : une règle « Virement interne » avec une sortie « contient LIVRET → compte en face Livret A » et une autre « contient PEA → compte en face PEA ».",
  "regles.tuto-resume":
    "Écrire une règle de bout en bout : ce qu'elle détecte, ce qu'elle change, ses sorties conditionnelles, et l'ordre dans lequel les règles se lisent.",
  "regles.tuto-page":
    "Les règles s'appliquent à chaque ligne importée, avant que tu ne la voies dans l'aperçu. Elles vivent ici, au-dessus des correspondances.",
  "regles.tuto-nouvelle":
    "Ce bouton ouvre l'éditeur d'une règle vide. On vient de l'ouvrir pour toi : rien n'est enregistré tant que tu ne cliques pas sur « Enregistrer ».",
  "regles.tuto-nom":
    "Un nom qui dit ce que la règle fait, et une note qui dit pourquoi elle existe — dans six mois, c'est la seule chose qui manquera.",
  "regles.tuto-detection":
    "Ce que la règle doit reconnaître. Une condition porte sur un champ de la ligne (libellé, catégorie bancaire, compte, montant) ; ses mots-clés se combinent en ET. Les groupes permettent d'écrire « (A ou B) et C ». Majuscules et accents sont ignorés.",
  "regles.tuto-action":
    "Ce que la règle fait de la ligne reconnue : son type, puis sa catégorie (ou une découpe entre plusieurs). « — ne pas changer — » laisse le type aux règles suivantes.",
  "regles.tuto-autres":
    "Tout le reste de la ligne peut changer aussi, sauf ses montants et sa date : son nom, son compte, une note, un amortissement. Un champ vide ne change rien.",
  "regles.tuto-notes":
    "Si ton preset lit la colonne « Notes » du relevé, une condition peut aussi porter sur elle : utile quand la banque écrit la référence utile dans le commentaire plutôt que dans le libellé.",
  "regles.tuto-ajout-champ":
    "Rien ne s'affiche d'office : « + Ajouter un champ » pose une propriété à la fois, et la croix la retire. Même geste que dans les sorties conditionnelles, juste en dessous.",
  "noyau.tuto-import-notes":
    "La colonne « Notes » est éteinte au départ. Allume-la si ton relevé porte un commentaire ou une référence : il est recopié dans la note de l'opération, et tes règles peuvent s'en servir.",
  "regles.tuto-sorties":
    "Quand ce que la règle doit faire dépend d'un détail de la ligne, inutile de la recopier : ajoute des sorties. Chacune a ses conditions et ses actions, et la première qui correspond l'emporte. Typiquement : une seule règle « Virement interne », une sortie par compte en face.",
  "regles.tuto-ordre":
    "Les règles se lisent de haut en bas. Coché, ce réglage arrête la lecture quand la règle correspond ; décoché, les suivantes peuvent compléter ce qu'elle a laissé ouvert. La plus haute l'emporte toujours.",
  "regles.tuto-liste":
    "L'ordre se change en glissant les règles dans la liste. La vue galerie les range par dossiers pour s'y retrouver, sans jamais changer cet ordre. Pour voir le résultat, importe un relevé : l'aperçu dit, ligne par ligne, quelle règle a agi.",
  "regles.conditions":

    "Les groupes se combinent entre eux ; à l'intérieur d'un groupe, les conditions se combinent selon leur propre connecteur. Deux niveaux suffisent à écrire « (A ou B) et C ».",
  "regles.action":
    "Le type détermine ce qui suit : seules « Opération classique » et « Dépense remboursable » laissent choisir une catégorie — les autres types imposent la leur. Chaque part dit combien elle prend. On peut écrire un nombre (50), un pourcentage (30%), une opération (montant - 50), ou utiliser min et max — par exemple min(montant; 50) pour « au plus 50 € ». Le mot reste donne à une part tout ce que les autres n'ont pas pris ; une seule part peut le porter, et la somme doit valoir le montant de la ligne.",

  /* ----- Extension « Suivi des remboursements » ----- */
  "suivi-remboursements.on-te-doit":
    "Le reste dû de tes dépenses remboursables, celles que tu as avancées. Une ligne par monnaie : rien n'est additionné d'une devise à l'autre. Seules les opérations réelles comptent.",
  "suivi-remboursements.tu-dois":
    "Le reste dû de tes prêts reçus, une ligne par monnaie. Nécessite l'extension « Prêts » pour qu'il existe des prêts à suivre.",
  "suivi-remboursements.solde-net":
    "Ce qu'on te doit moins ce que tu dois, DANS chaque monnaie — jamais entre elles. C'est le même chiffre que la carte « Reste à rembourser » du tableau de bord, qui n'en montre qu'une à la fois.",
  "suivi-remboursements.qui-doit-combien":
    "Une ligne par profil, et à l'intérieur une barre par monnaie où il porte quelque chose. La barre va à droite quand on te doit, à gauche quand tu dois ; sa longueur se compare au plus gros solde de SA monnaie — deux devises ne se comparent jamais. Clique une ligne pour voir ses opérations.",
  "suivi-remboursements.a-rattacher":
    "Les dépenses remboursables et les prêts encore dus qu'aucun profil ne porte. Coche des lignes, choisis un profil, et le tableau du dessus se met à jour.",
  "suivi-remboursements.profils":
    "Une étiquette, et rien de plus : aucun calcul de l'application ne la lit. En supprimer un détache ses opérations, il ne les efface jamais.",
  "suivi-remboursements.rien-a-suivre-pour-l-instant-aucune-depense":
    "Rien à suivre pour l'instant : aucune dépense remboursable ni aucun prêt reçu n'attend de règlement. Les lignes apparaîtront ici dès qu'il en existera une.",
  "suivi-remboursements.suivi-des-remboursements":
    "Qui te doit combien, et à qui tu dois. Un profil est une étiquette : une personne, une entreprise, la colocation. Rien n'est recalculé ailleurs — les soldes, le dashboard et l'histogramme donnent exactement les mêmes chiffres, cet écran ne fait que les ventiler.",


  /* ----- L'écran « D'où vient l'écart ? » ----- */
  "noyau.ecart-explication":
    "Les deux variations ne répondent pas à la même question, elles n'ont donc jamais le même chiffre. Voici, opération par opération, ce qui les sépare sur la période affichée.",
  "noyau.ecart-total":
    "La variation brute moins la variation attribuée. C'est exactement la somme de la colonne « Écart » ci-dessous : tout ce qui a bougé le compte sans appartenir à cette période, ou l'inverse.",
  "noyau.ecart-liste":
    "Chaque ligne montre ce que l'opération apporte aux DEUX calculs. « Au compte » : ce qui est passé, à sa date et pour son montant. « Au mois » : ce que la période en porte réellement. Une opération qui compte pareil des deux côtés n'apparaît pas — elle n'explique rien.",
  "noyau.ecart-vide":
    "Aucun écart sur cette période : les deux variations disent la même chose.",

  /* ----- Les colonnes de l'import bancaire (posées par app.js) ----- */
  "noyau.import-propriete-categorie_banque":
    "La catégorie que ta banque a posée elle-même sur la ligne.\n\nElle ne devient pas une catégorie de l'app toute seule : tu fais le rapprochement une fois, il est retenu.",
  "noyau.import-propriete-notes":
    "Un commentaire, une référence ou un mémo que ta banque écrit à côté du libellé.\n\nIl est recopié dans les notes de l'opération (sauf si une règle en pose une), et tes règles peuvent le tester comme le libellé.",
  "noyau.import-propriete-compte_banque":
    "Le compte concerné, quand le fichier le nomme.\n\nInutile si le preset est déjà lié à un compte : ce lien vaut pour toutes les lignes.",
  "noyau.import-propriete-sens":
    "À régler seulement si ton relevé n'écrit que des montants positifs et dit à part si l'argent entre ou sort.\n\nLes mots-clés reconnus se règlent juste en dessous.",
  "noyau.import-propriete-monnaie":
    "La devise du montant.\n\nSans elle, la ligne part dans la monnaie principale de son compte — faux dès qu'un compte en porte plusieurs.",
  "noyau.import-propriete-montant_initial":
    "Ce qui PART du compte, avant frais et avant conversion ; « Montant » décrit alors ce qui ARRIVE.\n\nC'est le couple qu'il faut pour importer un virement entre deux devises : seul ton relevé connaît les deux montants.",
  "noyau.import-propriete-monnaie_initiale":
    "La devise du montant envoyé.\n\nSans elle, l'app la suppose identique à celle du montant reçu, donc sans change.",
  "noyau.import-propriete-frais":
    "Les frais prélevés par la banque.\n\nC'est leur DEVISE qui décide auquel des deux montants ils se rapportent : dans la monnaie envoyée ils s'y ajoutent, dans celle reçue ils s'en retranchent. Dans une troisième, l'import est refusé plutôt que de fausser un solde.",
  "noyau.import-propriete-monnaie_frais":
    "La devise des frais, celle qui dit à quel montant ils s'appliquent.\n\nSans elle, l'app les rattache au montant envoyé et te le signale à chaque import.",
  "noyau.import-propriete-montant":
    "Le montant de la ligne, avec son signe : négatif il sort, positif il entre.\n\nSi ton relevé sépare sorties et entrées en deux colonnes, éteins celle-ci et règle « Montant au débit » et « Montant au crédit ».",
  "noyau.import-propriete-montant_debit":
    "Pour les relevés qui SÉPARENT sorties et entrées en deux colonnes, chaque ligne n'en remplissant qu'une.\n\nLa colonne remplie dit le sens. Un zéro vaut une case vide, une ligne qui remplit les deux part en erreur.",
  "noyau.import-propriete-montant_credit":
    "L'autre moitié : ce qui ENTRE.\n\nElle va toujours avec « Montant au débit » — allumer ou éteindre l'une fait la même chose à l'autre.",
  "noyau.import-propriete-statut":
    "Où en est l'opération chez ta banque.\n\nUne ligne en attente devient une opération prévisionnelle, une ligne refusée n'est pas importée. Les mots-clés se règlent plus bas.",

  /* ----- Les colonnes de l'import de placements (posées par son JS) ----- */
  "import-placements.propriete-position-quantite":
    "Le nombre de titres que tu DÉTIENS au moment de la photographie.\n\nC'est cette quantité qui part en base : l'app ne sait pas comment tu y es arrivé, seulement ce que tu as.",
  "import-placements.propriete-position-prix_revient":
    "Ce qu'UN titre t'a coûté en moyenne, frais compris (le PRU).\n\nPar titre, pas le total investi. Si ton relevé donne le total, divise-le avant d'importer.",
  "import-placements.propriete-position-valeur_totale":
    "Ce que la ligne vaut aujourd'hui, tous titres confondus.\n\nElle ne crée aucune détention : elle sert à déduire le cours du titre (valeur ÷ quantité), que ce genre d'export ne donne pas.",
  /* LE MÊME TEXTE QUE « propriete-operations-type_titre », PLUS BAS, et il doit
     le rester : la colonne « Type de titre » veut dire exactement la même chose
     dans les deux modes de lecture. Les deux entrées existent parce que chaque
     mode lit ses info-bulles par son préfixe (cf. implTextesProprietes) —
     réécrire l'une sans l'autre ferait diverger deux écrans jumeaux. */
  "import-placements.propriete-position-type_titre":
    "L'étiquette du titre, si ton fichier la porte : ETF, obligation, action…\n\nFacultative, et sans effet sur un montant. Un libellé que tu n'as pas encore créé le sera à l'import. Un titre que l'app connaît déjà garde le type que tu lui as posé.",
  "import-placements.propriete-operations-type_placement":
    "Ce que la ligne décrit : un achat, une vente, ou un transfert d'espèces.\n\nLes mots-clés se règlent juste en dessous. Un libellé inconnu met la ligne en erreur plutôt que d'être deviné.",
  "import-placements.propriete-operations-nom_valeur":
    "Le nom du titre tel que ton courtier l'écrit.\n\nFacultatif si tu lis l'ISIN, mais il faut l'un des deux : sans eux, une ligne d'achat ne dit pas de quelle valeur elle parle.",
  "import-placements.propriete-operations-code_isin":
    "Le code ISIN du titre (FR0000120073, LU1681043599…).\n\nSeul nom qui ne change jamais : c'est par lui qu'un titre est reconnu d'un import à l'autre. Facultatif si tu lis le nom de la valeur.",
  "import-placements.propriete-operations-montant":
    "Ce que l'opération a coûté ou rapporté en espèces.\n\nC'est lui qui fait foi : le prix par titre vaut montant ÷ quantité, pas le cours annoncé. Ton solde colle ainsi au relevé, frais de courtage compris.",
  "import-placements.propriete-operations-quantite":
    "Le nombre de titres achetés ou vendus.\n\nSans objet sur une ligne de transfert d'espèces, qui peut la laisser vide.",
  "import-placements.propriete-operations-cours":
    "Le prix par titre annoncé par le relevé.\n\nIl ne décide de rien, il sert de contrôle : un écart de plus de 1 % avec le montant divisé par la quantité est signalé au-dessus de l'aperçu, sans bloquer l'import.",
  "import-placements.propriete-operations-type_titre":
    "L'étiquette du titre, si ton fichier la porte : ETF, obligation, action…\n\nFacultative, et sans effet sur un montant. Un libellé que tu n'as pas encore créé le sera à l'import. Un titre que l'app connaît déjà garde le type que tu lui as posé.",
  "import-placements.import-de-placements":
    "Lit une liste d'opérations exportée depuis un compte de placements : achats, ventes et transferts d'espèces. Rien n'entre en base avant que tu ne valides l'aperçu.",
  "import-placements.configuration-du-fichier":
    "Quelle colonne du fichier porte quoi. Les numéros sont ceux d'Excel : la première colonne est la n°1. L'œil barré ne lit pas la colonne.",
  "import-placements.reglages-de-lecture-delimiteur-separateur-decimal":
    "À utiliser si le fichier n'est pas lu correctement (colonnes mélangées, montants illisibles) : la détection automatique du délimiteur et de la virgule décimale française ne convient pas à tous les formats d'export.",
  "import-placements.le-fichier-tel-qu-il-est":
    "Chaque colonne lue est colorée et porte le nom de la propriété qui sera importée. Les colonnes grises sont ignorées. Si une couleur ne tombe pas en face des bonnes données, corrige les numéros de colonne dans « Configuration du fichier » au-dessus.",
  "import-placements.apercu-ligne-s":
    "Les doublons détectés sont pré-sélectionnés. Tant qu'il reste des lignes sélectionnées, l'import est bloqué : supprime-les, ou décoche-les pour les importer quand même.",
  "import-placements.titres-detenus-ligne-s":
    "Chaque ligne devient un achat daté du jour de la photographie : c'est ainsi qu'une détention existe dans l'application, et c'est ce qui rend justes d'un coup la valorisation et les plus-values. Les espèces du compte baissent donc du total investi — pense à poser son solde initial en conséquence.",
  "import-placements.transferts-internes-ligne-s":
    "Le relevé ne décrit qu'un côté du mouvement : indique le compte en face. Le sens (émetteur ou récepteur) est déduit du signe du montant.",
  "import-placements.doublons-detectes-ligne-s":
    "Chaque ligne jugée identique (hors colonnes exclues, cf. Configuration du fichier) à une ligne déjà importée sous ce preset est affichée ici, suivie en lecture seule de celle qu'elle double. Elles sont pré-sélectionnées pour être supprimées d'un clic — décoche-en une pour l'importer quand même (deux achats identiques le même jour sont un doublon détecté légitime).",
  "import-placements.transferts-deja-connus-ligne-s":
    "Ces transferts ressemblent à un virement déjà enregistré : même montant, mêmes comptes, à quelques jours près. C'est normal — le même mouvement figure sur le relevé du courtier et sur celui du compte courant. Seuls les virements qui touchent le compte de ce preset sont comparés. Rien n'est bloqué ni pré-sélectionné : toi seul sais si tu as vraiment fait deux fois le mouvement. Chaque ligne est suivie de ce à quoi elle ressemble.",
  "import-placements.lignes-en-erreur-ligne-s":
    "Ces lignes ne seront pas importées telles quelles. Corrige-les avec « Modifier », ou supprime-les de l'aperçu — le reste du fichier s'importe normalement.",
  "import-placements.conditions":
    "Les groupes se combinent entre eux ; à l'intérieur d'un groupe, les conditions se combinent selon leur propre connecteur. Deux niveaux suffisent à écrire « (A ou B) et C ».",
  "import-placements.action":
    "Une ligne de compte-titres n'a pas de catégorie : un mouvement de titres n'en porte pas. Un transfert, lui, touche deux comptes et le relevé n'en nomme qu'un — la règle peut donc désigner le second.",

  /* ----- Extension « Monnaies » — la case d'agrégation (posée par son JS) ----- */
  "monnaies.agregation":
    "Additionne tes monnaies en une seule, au taux que tu as saisi dans Paramètres → Monnaies. Rien n'est modifié : décoche et tout revient. Une monnaie sans taux est laissée de côté, et signalée.",
};

/**
 * Remplace les clés par leurs textes, dans le fragment donné.
 *
 * APPELÉ AVANT `traduireDomStatique`, aux DEUX endroits où du HTML statique
 * entre dans la page : au démarrage sur `document.body` (cf. app.js) et à
 * chaque injection d'écran d'extension (cf. extensions.js). Une clé posée plus
 * tard par du JS ne serait pas vue — c'est pourquoi le JS, lui, lit `TEXTES`
 * directement par `texteAide()`.
 *
 * UNE CLÉ INCONNUE NE CASSE RIEN et ne laisse pas un trou : l'attribut reste en
 * place et la clé s'affiche telle quelle. On voit alors immédiatement laquelle
 * manque, là où un texte vide aurait donné une pastille muette qu'on aurait
 * mis des mois à remarquer.
 */
function appliquerTextes(racine) {
  racine.querySelectorAll("[data-info-cle]").forEach((el) => {
    el.setAttribute("data-info", texteAide(el.dataset.infoCle));
  });
  racine.querySelectorAll("[data-texte-cle]").forEach((el) => {
    el.textContent = texteAide(el.dataset.texteCle);
  });
}

/**
 * La description d'une extension : celle de textes.js (`<id>.description`),
 * et à défaut celle de son manifeste — le cas d'une extension tierce, que ce
 * fichier ne connaît pas.
 */
function descriptionExtension(extension) {
  const cle = `${extension.id}.description`;
  return TEXTES[cle] !== undefined ? TEXTES[cle] : extension.description || "";
}

/** Le texte d'une clé, ou la clé elle-même si elle est inconnue. */
function texteAide(cle) {
  return TEXTES[cle] !== undefined ? TEXTES[cle] : cle;
}

/* ---------- LA MISE EN FORME D'UNE PHRASE D'AIDE ----------
 *
 * POURQUOI. Certaines explications ÉNUMÈRENT des cas, d'autres renvoient à un
 * écran (« dans Paramètres → Comptes »). Écrits à la suite, les cas forment un
 * pavé qu'on relit trois fois pour trouver le sien ; un renvoi écrit en toutes
 * lettres oblige à refaire le chemin à la main. Quatre marqueurs, écrits DANS
 * la phrase, suffisent à dire les deux :
 *
 *   - « /- » (ou « -- », la forme d'origine) ouvre une PUCE. Ce qui précède le
 *     premier marqueur est l'introduction.
 *   - « // » est un SAUT DE LIGNE : ce qui suit forme un nouveau paragraphe,
 *     avec ses propres puces éventuelles.
 *   - « /bold(texte) » met en GRAS, « /italic(texte) » en ITALIQUE.
 *   - « /Chemin/Vers/L'écran » est un LIEN. Le marqueur disparaît de
 *     l'affichage, et c'est le texte qu'il décrit — le chemin écrit en toutes
 *     lettres juste AVANT lui (« Paramètres → Comptes ») — qui devient bleu et
 *     cliquable. Le chemin S'ARRÊTE À LA PONCTUATION (« ) , . ; : ! ? »), ou en
 *     fin de phrase : « /Paramètres/Base de données. » désigne bien « Base de
 *     données ».
 *
 * Pas de balise, pas de second champ, pas de clé à part — une phrase d'aide
 * reste UNE chaîne, et c'est ce qui permet au dictionnaire i18n de continuer à
 * la traduire d'un seul tenant (cf. le bloc d'en-tête de ce fichier).
 *
 * LE DÉCOUPAGE SE FAIT À L'AFFICHAGE, JAMAIS AU STOCKAGE, et c'est la
 * condition de ce qui précède : `data-info` voyage avec ses marqueurs, sa
 * traduction anglaise aussi, et la bulle découpe au moment de s'ouvrir.
 * Découper plus tôt aurait exigé une entrée de dictionnaire par morceau.
 *
 * UN CHEMIN SE RÉSOUT AU CLIC, PAS À L'ÉCRITURE (cf. notice.js,
 * `ouvrirCheminApplication`) : il désigne des onglets PAR LEUR NOM, dans la
 * langue affichée, et les onglets d'une extension n'existent qu'une fois
 * celle-ci chargée — c'est-à-dire bien après que la notice a été écrite.
 */
const PUCE_MARQUEUR = "--";
const SAUT_MARQUEUR = "//";
// « /- » et sa variante « / - », plus « -- » : la forme d'origine reste lue,
// toutes les phrases écrites avant la nouvelle ne sont donc pas à reprendre.
const PUCE_MOTIF = /\s*(?:--|\/\s?-)\s*/;
// Ce qui arrête un chemin : la ponctuation, ou un autre marqueur.
const CHEMIN_FIN = /[),.;:!?«»(\n]/;

/** Vrai si la phrase porte au moins un marqueur (et demande donc un rendu). */
function texteAMarqueurs(texte) {
  const s = String(texte || "");
  return s.includes(SAUT_MARQUEUR) || PUCE_MOTIF.test(s) || debutCheminDans(s, 0) !== -1;
}

/* L'indice du prochain « / » qui ouvre un chemin, ou -1. Un chemin commence
 * EN DÉBUT DE PHRASE OU APRÈS UN BLANC, et son premier caractère est une
 * lettre : « et/ou », « 1/12 » ou « // » ne sont pas des chemins. */
function debutCheminDans(texte, depuis) {
  for (let i = texte.indexOf("/", depuis); i !== -1; i = texte.indexOf("/", i + 1)) {
    const avant = i === 0 ? " " : texte[i - 1];
    if (/\s/.test(avant) && /\p{L}/u.test(texte[i + 1] || "")) return i;
  }
  return -1;
}

/**
 * {intro, puces} — `puces` est vide quand la phrase n'en porte aucune.
 * Conservé tel quel pour qui ne veut que le découpage en puces.
 */
function texteEnPuces(texte) {
  const morceaux = String(texte || "").split(PUCE_MOTIF);
  const intro = morceaux.shift().trim();
  return {
    intro,
    // Une puce vide (deux marqueurs qui se suivent, un marqueur en fin de
    // phrase) n'apprend rien et laisserait une ligne blanche dans la liste.
    puces: morceaux.map((m) => m.trim()).filter(Boolean),
  };
}

function echapperRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Le texte que décrit un chemin, pris à la fin de ce qui le précède.
 *
 * ON CHERCHE LE CHEMIN ÉCRIT EN TOUTES LETTRES, du plus long au plus court :
 * « Paramètres → Comptes » pour /Paramètres/Comptes, puis « Comptes » seul.
 * Entre deux étapes, n'importe quel séparateur usuel (→, >, /, espace).
 *
 * À DÉFAUT, LE DERNIER MOT : « la fonctionnalité d'amortissement /Les types
 * d'opérations » n'écrit pas le chemin, et rien ne dit où commence ce que
 * l'auteur voulait souligner. Un mot reste cliquable ; souligner la phrase
 * entière aurait été deviner.
 */
function libelleDuChemin(avant, etapes) {
  for (let k = etapes.length; k >= 1; k--) {
    const motif = etapes
      .slice(-k)
      .map((e) => echapperRegExp(e.trim()) + "s?")
      .join("\\s*(?:→|->|>|/|»)?\\s*");
    const trouve = new RegExp(`(${motif})\\s*$`, "i").exec(avant);
    if (trouve) return { avant: avant.slice(0, trouve.index), libelle: trouve[1] };
  }
  const mot = /(\S+)\s*$/.exec(avant);
  if (mot) return { avant: avant.slice(0, mot.index), libelle: mot[1] };
  // Rien avant le marqueur : le chemin se nomme lui-même.
  return { avant, libelle: etapes.join(" → ") };
}

/* GRAS ET ITALIQUE : « /bold(texte) » et « /italic(texte) ». Lus AVANT les
 * chemins — « /bold( » commence comme un chemin — et récursivement : le texte
 * entre parenthèses peut porter un lien ou l'autre style. Les parenthèses
 * s'équilibrent, un « ) » ouvert à l'intérieur ne ferme donc rien. Une
 * parenthèse jamais refermée met en forme jusqu'à la fin du morceau. */
const STYLE_MOTIF = /\/(bold|italic)\(/;

/** Écrit un morceau de texte dans `parent` : styles, puis chemins en liens. */
function ecrireMorceauAvecChemins(parent, texte) {
  const trouve = STYLE_MOTIF.exec(texte);
  if (!trouve) {
    ecrireCheminsSeuls(parent, texte);
    return;
  }
  ecrireCheminsSeuls(parent, texte.slice(0, trouve.index));
  const debut = trouve.index + trouve[0].length;
  let profondeur = 1;
  let i = debut;
  for (; i < texte.length && profondeur > 0; i++) {
    if (texte[i] === "(") profondeur++;
    else if (texte[i] === ")") profondeur--;
  }
  const ferme = profondeur === 0;
  const fin = ferme ? i - 1 : texte.length;
  const element = document.createElement(trouve[1] === "bold" ? "strong" : "em");
  ecrireMorceauAvecChemins(element, texte.slice(debut, fin));
  parent.appendChild(element);
  if (ferme) ecrireMorceauAvecChemins(parent, texte.slice(fin + 1));
}

/** Écrit un morceau de texte dans `parent`, chemins changés en liens. */
function ecrireCheminsSeuls(parent, texte) {
  let reste = texte;
  let i;
  while ((i = debutCheminDans(reste, 0)) !== -1) {
    let fin = i + 1;
    while (fin < reste.length && !CHEMIN_FIN.test(reste[fin])) {
      // Un autre marqueur de chemin arrête aussi celui-ci.
      if (reste[fin] === "/" && /\s/.test(reste[fin - 1])) break;
      fin++;
    }
    const brut = reste.slice(i + 1, fin).trim();
    const etapes = brut.split("/").map((e) => e.trim()).filter(Boolean);
    const { avant, libelle } = libelleDuChemin(reste.slice(0, i).replace(/\s+$/, ""), etapes);
    if (avant) parent.appendChild(document.createTextNode(avant + (/\s$/.test(avant) ? "" : " ")));
    const lien = document.createElement("a");
    lien.className = "lien-chemin";
    lien.href = "#";
    lien.dataset.chemin = etapes.join("/");
    lien.textContent = libelle;
    parent.appendChild(lien);
    reste = reste.slice(fin);
  }
  if (reste) parent.appendChild(document.createTextNode(reste));
}

/**
 * Écrit un texte d'aide dans un élément : paragraphes, puces, liens.
 *
 * CONSTRUIT EN NŒUDS, JAMAIS EN `innerHTML` : ces phrases sont écrites à la
 * main dans ce fichier, mais rien n'oblige la suivante à l'être — et une
 * fonction qui accepte du HTML finit toujours par en recevoir d'ailleurs.
 */
function ecrireTexteAide(el, texte) {
  el.textContent = "";
  const blocs = String(texte || "")
    .split(SAUT_MARQUEUR)
    .map((b) => b.trim())
    .filter(Boolean);
  // UN SEUL BLOC SANS PUCE s'écrit à plat, comme avant : une pastille « i »
  // ordinaire ne doit pas gagner un paragraphe et sa marge.
  const simple = blocs.length <= 1 && !texteEnPuces(blocs[0] || "").puces.length;
  if (simple) {
    ecrireMorceauAvecChemins(el, blocs[0] || "");
    return;
  }
  blocs.forEach((bloc) => {
    const { intro, puces } = texteEnPuces(bloc);
    if (intro) {
      const paragraphe = document.createElement("p");
      paragraphe.className = "texte-aide-intro";
      ecrireMorceauAvecChemins(paragraphe, intro);
      el.appendChild(paragraphe);
    }
    if (!puces.length) return;
    const liste = document.createElement("ul");
    liste.className = "texte-aide-puces";
    puces.forEach((puce) => {
      const ligne = document.createElement("li");
      ecrireMorceauAvecChemins(ligne, puce);
      liste.appendChild(ligne);
    });
    el.appendChild(liste);
  });
}

/**
 * La passe de mise en forme des BLOCS d'aide (`data-texte-cle`), à lancer
 * APRÈS `traduireDomStatique`.
 *
 * Ces blocs reçoivent leur phrase en un seul nœud de texte — c'est ce que le
 * dictionnaire traduit — et ce n'est donc qu'une fois traduits qu'on peut les
 * découper sans perdre l'anglais. Les pastilles « i », elles, n'ont pas besoin
 * de cette passe : leur texte vit dans un ATTRIBUT et la bulle le découpe en
 * s'ouvrant (cf. app.js, `afficherInfobulle`).
 */
function appliquerPuces(racine) {
  racine.querySelectorAll("[data-texte-cle]").forEach((el) => {
    if (texteAMarqueurs(el.textContent)) ecrireTexteAide(el, el.textContent);
  });
}

Object.assign(TEXTES, {

  /* ----- Les descriptions des extensions -----
     Affichées dans Paramètres → Extensions, dans la notice (chapitre « Les
     extensions ») et dans la fenêtre « Extensions détectées », que
     l'extension soit allumée ou non. La clé est `<identifiant>.description`.
     Une extension tierce, absente d'ici, garde la description de son
     manifeste (cf. descriptionExtension, plus bas). */
  "analyse-budget.description":
    "C'est LA page pour pouvoir tenir ton budget. // Elle te permet de sélectionner un budget pour ton mois et de choisir des budgets par catégorie. // Tu peux l'utiliser pour comparer les graphiques du dashboard sur différentes périodes, et mieux comprendre comme tu gères ton argent avec plus de recul. // Elle te permet également d'avoir accès à trois nouveaux indicateurs : /- L'argent que tu as mis de côté sur la période (virements internes vers tes comptes d'épargne ou de placements) /- Un matelas de sécurité que tu définis, utile pour s'assurer que ce dernier se porte bien /- La classification de dépenses comme étant imprévues, et le montant de ces imprévus sur la période : cet indicateur te permet de mieux comprendre ce qu'on n'anticipe jamais et qu'on finit par souvent par définir comme impossible à prendre en compte dans le budget ",
  "import-placements.description":
    "C'est l'extension te permettant d'importer des relevés pour tes titres de placements (nécessite l'extension Placements). Le mécanisme d'import est le même que celui pour l'import d'informations, et l'information clé est l'ISIN d'un titre - un identifiant unique.",
  "interets-percus.description":
    "Un compte d'épargne te rapporte de l'argent passivement, à des fréquences différences (journalier, mensuel, annuel, ...). Néanmoins, une opération ne s'écrit pas pour autant dans tes relevés - l'app affichera donc un montant erroné pour ton compte de placements quand tes intérêts apparaîtront sur ton compte. // Cette extension - s'affichant dans la page Vue des avoirs /Vue des avoirs - te permet de renseigner à la main ces intérêts et les assigner à un compte de placements.",
  "investing-overview.description":
    "Cette extension te permet d'avoir une vue d'ensemble sur les actifs que tu possèdes (nécessite l'extension Placements), avec plusieurs classifications (type d'actifs, d'enveloppes) pour mieux comprendre ce que tu possèdes, comment et à quoi tes actifs t'exposent.",
  "lecture-de-cours.description":
    "IMPORTANT : cette extension est la seule à te permettre de relier ton app à internet. Elle te permet de fournir des liens de pages de cotation pour que l'app les utilise : elle nécessite l'extension Placements financiers (lecture de cours d'actifs) ou Monnaies (lecture de taux de change).",
  "monnaies.description":
    "Sans cette extension, l'application est mono-devise. L'activer te permet de créer de nouvelles monnaies, et donc de relier des dépenses ou des comptes à différentes monnaies pour ne pas mélanger ce qui ne se mélange.",
  "objectifs.description":
    "Cette extension te permet de créer des objectifs personnalisés pour gérer tes dépenses comme tu le souhaites. Tu peux créer des indicateurs personnalisés prenant en compte la fréquence, le montant moyen, le montant total, une part, pour comprendre et agir plus en détails qu'avec de simples limites sur des catégories (ex : mes courses devraient 300€ en moyenne par mois / je vise 2 sorties resto max par semaine / j'épargne au moins 50€ par mois).",
  "placements.description":
    "Grâce à cette extension, tu peux renseigner et comprendre les actifs que tu détiens (achat, vente, plus-value, valorisation). Une fois activée, tu retrouveras cette page en onglet de la page Vue des avoirs /Vue des avoirs.",
  "prets.description":
    "Te permet de classifier comme tel et suivre l'argent qu'on t'a prêté (intérêts compris). Le fonctionnement de ces types d'opérations est similaire aux opérations remboursables / remboursements.",
  "projets.description":
    "Un voyage, un investissement dans une activité sous différentes formes, des rénovations ? Difficile de suivre ça avec seulement des catégories. Tu peux donc créer un projet, et y rajouter toutes les opérations que tu veux. Tu obtiens alors une vue détaillée de ce que ton projet t'a coûté - ou rapporté - classifié en catégories.",
  "regles.description":
    "L'une des extensions phares de l'application. Ta banque fournit un libellé conséquent pour des dépenses récurrentes, que tu dois renommer sans cesse ? Tu voudrais automatiser les modifications récurrentes que tu fais ? L'extension règle t'apporte la flexibilité de faire /bold(ce que tu veux).",
  "suivi-remboursements.description":
    "On te doit de l'argent à droite à gauche, et tu dois des dépenses, des montants, de combien on t'a remboursé et des personnes de tête ? // Active cette extension pour avoir accès à deux types d'opérations : /- les opérations remboursables : tu peux y sélectionner le montant à rembourser, le montant dû et l'extension te permet d'ajouter qui te doit l'argent via le menu Suivi des remboursements /- les remboursements reçus : comme une opération classique, que tu peux relier à l'opération remboursable - le montant dû se met alors automatiquement à jour // italic(La page Suivi des remboursements te permet de voir tous tes remboursements en attente et indiquer qui te doit quoi.)",
});
