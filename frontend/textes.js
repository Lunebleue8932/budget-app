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
  "noyau.parametres-generaux":
    "Ce qui règle ta façon de te servir de l'application, et non ton budget : ces réglages vivent sur CE poste, pas dans la base. Changer de machine ne les emporte pas, et effacer les données du navigateur les remet à leur valeur d'origine.",
  "noyau.theme":
    "Le mode clair ou le mode sombre. Le choix vit sur cette machine, comme la langue : il ne voyage pas avec tes données, et l'autre poste garde le sien.",
  "noyau.touche-gel-infobulle":
    "Clique dans le champ, puis appuie sur la touche (ou la combinaison) que tu veux. Elle est enregistrée aussitôt. Elle n'agit jamais pendant que tu écris dans un champ de saisie, pour ne pas t'empêcher de taper la lettre elle-même. Figée, l'infobulle des graphes cesse d'être remplacée par le survol : tu récupères ton curseur pour lire son top 3 ou cliquer son bouton. La même touche, un clic à côté ou Échap la libèrent.",

  /* ----- Le camembert et ses deux vues ----- */
  "noyau.camembert-vue-budget":
    "Les parts sont rapportées au BUDGET DU MOIS et non au total dépensé : l'anneau reste donc ouvert sur ce qui n'a pas encore été dépensé. C'est la seule vue où l'objectif d'une catégorie veut dire quelque chose — rapportées au total dépensé, les parts somment 100 % par construction, et une catégorie ne peut tenir sa cible que si toutes les autres tiennent la leur. Ici, chacune est indépendante : « l'alimentaire devait peser 30 % de mon budget, il en pèse 22 % ».",
  "noyau.accord-des-budgets":
    "Le budget d'une catégorie devrait valoir le budget du mois multiplié par son objectif en pourcentage. Ces trois chiffres se saisissent séparément, et rien n'oblige à les poser tous — mais quand les trois existent et se contredisent, il faut choisir lequel a raison. Rien n'a été corrigé automatiquement : ta dernière saisie est enregistrée telle quelle, et tu peux très bien la laisser ainsi.",

  /* ----- L'application elle-même (index.html) ----- */
  "noyau.reste-a-rembourser":
    "Ce qu'on te doit encore sur tes dépenses remboursables, moins ce que tu dois encore sur les prêts reçus. NE DÉPEND PAS DE LA PÉRIODE : c'est l'état de tes créances et de tes dettes aujourd'hui, pas un chiffre du mois. Seules les opérations réelles comptent.",
  "noyau.total-entrees":
    "Ce que la période rapporte, virements internes exclus. Un prêt reçu n'y entre pas : il faudra le rendre. Reste sur le mois entier, semaine dépliée ou non.",
  "noyau.total-depenses":
    "Ce que la période coûte, et non ce qui sort du compte : une dépense amortie ne compte que pour sa part du mois, une remboursable pour le reste à charge. Virements internes exclus. Reste sur le mois entier, semaine dépliée ou non.",
  "noyau.variation-attribuee-au-mois":
    "Ce que la période laisse, au sens de ce qu'elle COÛTE : « Total Entrées » moins « Total Dépenses », les deux cartes juste à gauche. Une dépense amortie n'y pèse que pour sa part du mois, une remboursable pour son reste à charge. Son écart avec la variation brute, à droite, est exactement le décalage entre le moment où l'argent sort et le mois auquel la dépense appartient.",
  "noyau.variation-sur-le-mois-brute":
    "De combien les comptes courants ont RÉELLEMENT bougé sur la période — le chiffre du relevé. Tout compte à sa date et pour son montant : une dépense amortie en entier, une dépense remboursable sans déduire ce qu'on rendra. Virements internes exclus. En jaune parce qu'elle ne répond pas à la même question que ses voisines : elle ne dit pas si la période a été bonne, elle dit ce qui est passé.",
  "noyau.notes":
    "Un pense-bête, non lu par l'app. Ça s'enregistre tout seul.",
  "noyau.repartition-des-avoirs":
    "La part du total des avoirs posée sur chaque type de compte, dans la monnaie choisie. Solde RÉEL, titres détenus compris — pas le prévisionnel.",
  "noyau.comptes-de-placements":
    "Le solde affiché représente les espèces disponibles. La valeur de tes titres se lit dans Placements financiers.",
  "noyau.montant-min":
    "La valeur du montant sans son signe : « au moins 50 » attrape aussi bien une dépense de 80 € qu'une entrée de 80 €. Laisse une case vide pour ne pas borner de ce côté.",
  "noyau.montant-min-2":
    "La valeur du montant sans son signe. Laisse une case vide pour ne pas borner de ce côté.",
  "noyau.frais":
    "Les frais que la banque a prélevés, déjà compris dans le montant : ajoutés à ce qui sort, retranchés de ce qui entre. Le montant au-dessus est donc affiché hors frais, et les deux se recomposent à l'enregistrement.",
  "noyau.monnaie-des-frais":
    "La devise des frais dit à quel montant ils s'appliquent : sur un virement entre deux monnaies, des frais dans la monnaie envoyée grèvent ce qui part, dans la monnaie reçue ce qui arrive.",
  "noyau.decouper-entre-plusieurs-categories":
    "Une seule opération, plusieurs catégories : un plein de courses dont une part de produits ménagers. Le total des parts doit valoir le montant de l'opération.",
  "noyau.amortie-sur-plusieurs-mois":
    "La dépense reste datée du jour où l'argent est sorti — les soldes et les KPI du haut du dashboard ne bougent pas. Seuls l'histogramme et les totaux de la période répartissent son montant sur les mois choisis.",
  /* ----- La notice d'utilisation -----
     CES PHRASES SONT AUSSI CELLES DES ÉCRANS. La notice n'en écrit de
     nouvelles que pour ce qu'aucune pastille « i » ne dit déjà : partout
     ailleurs elle emploie les MÊMES clés que la page qu'elle décrit (cf. les
     `data-texte-cle` de la section #section-notice). C'est ce qui l'empêche de
     décrire une application qui n'existe plus. */
  "noyau.notice":
    "Le mode d'emploi de l'application, à l'intérieur de l'application. Ce que veut dire chaque chiffre du dashboard, ce que fait chaque type d'opération, et comment régler un import de bout en bout — avec un tutoriel guidé et un relevé d'exemple pour s'entraîner sans risque.",
  "noyau.notice-intro":
    "Cette application tient tes comptes hors ligne : rien ne sort de ta machine, aucun service n'est interrogé, aucune banque n'est connectée. Tu saisis ou tu importes tes opérations, elle calcule. Cette notice explique ce qu'elle fait, dans l'ordre où on en a besoin.",
  "noyau.notice-mot-compte":
    "Un endroit où l'argent se trouve : un compte courant, un livret, un compte-titres. Chaque compte porte une ou plusieurs monnaies, et son solde se déduit de son solde initial plus tout ce qui y est passé.",
  "noyau.notice-mot-operation":
    "Une ligne : une date, un libellé, un montant, un compte. C'est la brique de tout le reste — les soldes, les graphes et les totaux ne sont que des façons de les additionner.",
  "noyau.notice-mot-categorie":
    "Ce à quoi une dépense sert : alimentation, transports, loisirs. C'est par elles que l'histogramme et le camembert répartissent ce que tu dépenses. Tu les renommes, tu les ranges, tu en ajoutes — les quatre livrées ne sont qu'un point de départ.",
  "noyau.notice-mot-monnaie":
    "L'application ne mélange JAMAIS deux devises dans un même total : chaque écran qui affiche des montants a ses onglets ou sa liste de monnaie. Sans l'extension « Monnaies », il n'y en a qu'une et la question ne se pose pas.",
  "noyau.notice-demarrer-1":
    "Crée tes comptes, dans Paramètres → Comptes, avec leur solde de départ. C'est la seule chose qu'on ne peut pas deviner : tout le reste s'en déduit.",
  "noyau.notice-demarrer-2":
    "Range tes catégories, dans Paramètres → Catégories. Quatre sont livrées pour ne pas partir de rien ; renomme-les, supprime celles qui ne te servent pas, ajoute les tiennes.",
  "noyau.notice-demarrer-3":
    "Fais entrer tes opérations, à la main depuis la page Opérations, ou par un import de relevé — c'est le chapitre « Importer un relevé » de cette notice.",
  "noyau.notice-demarrer-4":
    "Regarde le dashboard. À partir de là, tout est lecture : les chiffres du haut disent où tu en es, ceux du bas ce que le mois a fait.",
  "noyau.notice-donnees":
    "Toutes tes données tiennent dans UN fichier, dont tu choisis l'emplacement au premier lancement et que tu peux déplacer ensuite depuis Paramètres → Base de données. Sauvegarde ce fichier comme tu sauvegardes une photo : le copier suffit, et le rouvrir depuis le même panneau te rend tout. L'application ne garde aucune copie ailleurs, et rien n'est envoyé nulle part.",
  "noyau.notice-dashboard-intro":
    "Le dashboard répond à deux questions différentes, et c'est pour ça qu'il a deux rangées de cartes. En haut, ce que tu AS aujourd'hui — ces chiffres ne bougent pas quand tu changes de mois. En bas, sous le sélecteur de période, ce que la période a FAIT.",
  "noyau.notice-kpi-solde-total":
    "Ce que portent tes comptes courants, aujourd'hui. Le chiffre plus petit à côté est le PRÉVISIONNEL : le même solde une fois passées les opérations que tu as écrites d'avance.",
  "noyau.notice-kpi-avoirs":
    "Tout ce que tu possèdes : comptes courants, épargne, et la valeur de tes titres si l'extension « Placements financiers » tourne. C'est le chiffre à regarder pour « est-ce que mon patrimoine monte ».",
  "noyau.notice-dashboard-ecart":
    "Les deux variations ne tombent jamais d'accord, et c'est normal : l'une dit ce que le mois COÛTE, l'autre ce qui est PASSÉ sur le compte. Quand elles diffèrent, un bouton apparaît dans la carte jaune et ouvre le détail, ligne par ligne, de ce qui explique l'écart.",
  "noyau.notice-graphes":
    "Les deux graphes montrent les mêmes catégories dans les mêmes couleurs, sur la période du sélecteur, et se pilotent avec le même filtre — le bouton « Catégories » dans leur titre. Survoler une barre, une tranche ou une ligne de légende éclaire les deux autres et ouvre une infobulle : elle porte le total, la part, et les trois plus grosses dépenses de la catégorie.",
  "noyau.notice-graphes-histogramme":
    "L'histogramme porte des MONTANTS : une barre par catégorie, et le trait rouge est le budget que tu lui as donné pour ce mois-ci (extension « Budget »).",
  "noyau.notice-graphes-camembert":
    "Le camembert porte des PARTS. En vue « État actuel », chaque tranche est rapportée au total dépensé et les parts font 100 %. En vue « Budget », elles sont rapportées au budget du mois : l'anneau reste ouvert sur ce qui n'a pas été dépensé.",
  "noyau.notice-graphes-legende":
    "La légende, sous les deux, ne porte que le nom et la part : c'est le point d'entrée le plus complet — son infobulle dit tout, et « Voir toutes les dépenses » t'emmène à la liste des opérations de cette catégorie.",
  "noyau.notice-graphes-semaines":
    "La petite flèche sous la rangée des mois déplie les SEMAINES : l'histogramme devient celui de la semaine choisie, et « Moyenne » répond à « est-ce que cette semaine-là était ordinaire ? ». Les cartes, elles, restent sur le mois.",
  "noyau.notice-types-intro":
    "Le type d'une opération dit ce qu'elle EST, et décide de la façon dont elle compte. L'application nue en connaît deux ; les autres s'ouvrent avec l'extension qui les explique, et ne sont décrits ici que si elle tourne chez toi.",
  "noyau.notice-type-classique":
    "Une dépense ou une entrée ordinaire : des courses, un salaire, une facture. C'est le type par défaut, le seul qui se découpe entre plusieurs catégories, et celui de la quasi-totalité de tes lignes.",
  "noyau.notice-type-virement":
    "De l'argent qui passe d'un de tes comptes à un autre. Ce n'est ni une dépense ni une entrée : ton patrimoine ne bouge pas, et c'est pour ça qu'un virement est écarté de tous les totaux de période. Une seule saisie écrit les deux côtés, et un virement entre deux monnaies porte les deux montants.",
  "noyau.notice-type-remboursable":
    "Une dépense que tu avances pour quelqu'un d'autre : tu paies 60 €, on t'en rendra 50. Elle ne pèse sur ton mois que pour ce qui reste à ta charge, et ce qu'on te doit encore s'affiche dans « Reste à rembourser ». Le remboursement reçu, quand il arrive, fait décroître cette dette tout seul.",
  "noyau.notice-type-pret":
    "De l'argent qu'on t'a prêté : il arrive sur ton compte, mais il faudra le rendre — il n'entre donc pas dans tes entrées. Ce que tu rendras EN PLUS de ce que tu as reçu est l'intérêt : c'est lui, et lui seul, qui pèse sur tes dépenses, dans sa propre barre d'histogramme.",
  "noyau.notice-type-action":
    "L'achat ou la vente d'un titre. Tu ne le saisis jamais depuis la page Opérations : il naît avec sa ligne dans l'écran des placements, et le mouvement d'espèces sur le compte-titres en découle.",
  "noyau.notice-types-extensions":
    "D'autres types existent et n'apparaissent qu'avec l'extension qui les ouvre : dépenses remboursables, prêts reçus, opérations sur titres. Va voir Paramètres → Extensions pour savoir ce que tu as sous la main.",
  "noyau.notice-statut":
    "Une opération RÉELLE a eu lieu ; une PRÉVISIONNELLE est écrite d'avance et ne pèse que sur le solde projeté. Quand la vraie ligne arrive par un import, l'application reconnaît la prévision et la remplace, plutôt que de compter la dépense deux fois.",
  "noyau.notice-import-intro":
    "Importer, c'est expliquer une fois à l'application comment ta banque écrit ses fichiers — puis ne plus jamais y revenir. Ce réglage s'appelle un PRESET : un par banque, gardé d'un import à l'autre. Rien n'est écrit dans tes comptes avant que tu aies vu, ligne par ligne, ce qui va entrer.",
  "noyau.notice-tutoriel-encart":
    "Le tutoriel ouvre l'écran d'import et te montre où regarder, étape par étape, sans rien écrire dans tes comptes. Le relevé d'exemple est un vrai fichier CSV — avec une ligne de titre parasite et trois colonnes inutiles, comme un export de banque : de quoi s'exercer à régler un import pour de bon.",
  "noyau.notice-exemple-colonnes":
    "Le réglage juste, si tu veux vérifier le tien : 2 lignes de tête, Date en colonne 1, Nature en 3, Montant en 5, Catégorie bancaire en 7. Les colonnes 2, 4 et 6 — référence, type de carte, solde après opération — ne sont lues par rien : une colonne qu'on n'importe pas n'a pas à être supprimée du fichier.",
  "noyau.notice-import-etape-1":
    "Choisis ou crée le PRESET qui correspond à ce fichier, et dis-lui sur quel compte il importe.",
  "noyau.notice-import-etape-2":
    "Dépose le fichier. L'application le relit aussitôt et montre, dans « Le fichier tel qu'il est », ce qu'elle a compris de chaque colonne.",
  "noyau.notice-import-etape-3":
    "Corrige la lecture si besoin : glisse les en-têtes pour remettre chaque propriété en face de la bonne colonne, dis combien de lignes de tête sauter, puis enregistre la configuration dans le preset.",
  "noyau.notice-import-etape-4":
    "Réponds à ce que l'aperçu te demande : à quelles catégories à toi correspondent celles de ta banque, quoi faire des doublons, et ce qu'il faut corriger ligne par ligne.",
  "noyau.notice-import-etape-5":
    "Confirme. C'est le seul geste qui écrit quelque chose dans tes comptes.",
  "noyau.notice-import-annuler":
    "L'historique des importations, en bas de l'écran d'import, ANNULE un import entier : les opérations qu'il a créées disparaissent, et les dépenses prévues qu'il avait remplacées reviennent exactement comme elles étaient. Rien n'est irréversible — c'est ce qui permet d'essayer un réglage plutôt que de le deviner.",
  "noyau.notice-extensions-intro":
    "L'application nue tient un budget complet. Les extensions ajoutent ce dont tout le monde n'a pas besoin : plusieurs devises, un portefeuille de titres, des prêts, des objectifs chiffrés. Elles se déposent dans le dossier « extensions » à côté de l'application, et rien ne se charge avant que tu l'aies allumée toi-même.",
  "noyau.notice-extensions-eteindre":
    "Éteindre une extension ne supprime AUCUNE donnée : son écran disparaît, ses lignes dorment en base, et tout revient intact quand tu la rallumes. C'est pour ça qu'on peut en essayer une sans rien risquer.",

  /* ----- Extension « Budget » -----
     L'espace de noms reste `analyse-budget`, l'identifiant du DOSSIER : c'est
     lui que porte `data-info-cle`, et il ne s'affiche nulle part. */
  "analyse-budget.budget-total":
    "Ce que tu te donnes à dépenser sur le mois, dans cette monnaie. C'est le dénominateur de tout le reste : la vue « Budget » du camembert du dashboard y rapporte chaque catégorie, et les objectifs en pourcentage ci-dessous sont des parts de LUI. Un mois que tu n'as pas rempli reprend le dernier montant écrit — avant comme après lui — et le dit. Zéro le retire.",
  "analyse-budget.budget-total-aide":
    "Il se pose mois par mois et monnaie par monnaie : 15 000 ¥ ne se comparent à aucun euro, et un budget de janvier ne dit rien de celui de février. Change de mois dans la rangée ci-dessus pour en écrire un autre.",
  "analyse-budget.budgets-categories":
    "Deux grandeurs par catégorie, et elles ne se déduisent pas l'une de l'autre. Le BUDGET est une enveloppe en valeur pour ce mois-ci : il répond à « combien puis-je encore dépenser », et c'est lui que dessine le trait rouge de l'histogramme du dashboard. L'OBJECTIF est une part du budget total, la même tous les mois et dans toutes les monnaies : il répond à « quelle part doit aller là », et c'est lui qu'affiche le camembert en vue Budget. Poser l'un n'oblige jamais à poser l'autre.",
  "analyse-budget.budgets-categories-aide":
    "Glisse pour répartir, écris dans le champ à côté pour poser une valeur exacte ; c'est en relâchant que ça s'enregistre. Les objectifs ne peuvent pas dépasser 100 % à eux tous — la course du curseur te dit ce qu'il reste à placer — mais rien ne t'oblige à les atteindre : n'en poser que sur trois catégories est le cas ordinaire. Quand le budget d'une catégorie et son objectif ne s'accordent plus avec le total du mois, la ligne le dit et propose les deux corrections chiffrées.",
  "analyse-budget.epargne":
    "Le solde d'un compte d'épargne dit ce qu'il Y A ; il ne dit pas ce que tu y as MIS ce mois-ci — et c'est pourtant la seule des deux qui résulte d'une décision. Le calcul se lit dans tes virements internes : tout ce qui part d'un compte courant vers un compte d'épargne ou de placements compte comme mis de côté, tout ce qui en revient compte en moins. Un virement d'épargne à épargne ne met rien de côté, il range autrement ce qui l'est déjà : il est ignoré.",
  "analyse-budget.epargne-aide":
    "Le grand chiffre est le NET — ce que tu as réellement mis de côté sur l'année. Survole-le pour voir ce qu'il recouvre : un net à zéro peut vouloir dire « je n'ai rien bougé » comme « j'ai versé 2 000 € et j'en ai repris 2 000 ». Seules les opérations RÉELLES comptent, une mise de côté prévue n'ayant pas encore eu lieu. Entre deux monnaies, c'est toujours le montant du côté de l'épargne qui compte : verser 100 € qui arrivent en 108 $ met bien 108 $ de côté.",
  "analyse-budget.matelas":
    "Le minimum que tu veux garder disponible sur tes comptes d'épargne, dans cette monnaie. Il ne bloque RIEN : aucun virement n'est refusé, aucune saisie n'est empêchée. L'app constate et te le dit, là où tu regardes tes comptes d'épargne. Une garde qui t'interdirait de descendre sous ton propre seuil se ferait contourner au premier vrai besoin, et tu aurais appris à ne plus la lire.",
  "analyse-budget.matelas-aide":
    "Les comptes d'ÉPARGNE seulement, et leur solde réel. Un compte de placements porte des titres, qui ne sont disponibles qu'après une vente, à un cours qu'on ne connaît pas d'avance : les compter dans un matelas de sécurité reviendrait à se rassurer avec de l'argent qu'on n'a pas encore. Laisse à zéro pour ne pas poser de seuil du tout.",
  "analyse-budget.imprevues":
    "Ce que tu n'avais pas vu venir : le plombier, la dent cassée, le pneu. Aucune catégorie ne répond à cette question — une dépense d'alimentation peut être imprévue, une réparation peut être parfaitement attendue — d'où une case à cocher sur la dépense elle-même. Le total te dit, mois par mois, quelle part de ce que tu dépenses n'était pas prévisible.",
  "analyse-budget.imprevues-aide":
    "Le périmètre est celui de l'histogramme des dépenses du dashboard : dépenses réelles, virements internes exclus. C'est ce qui rend la part comparable à ce que tu lis ailleurs.",
  "analyse-budget.imprevue-champ":
    "Coche si cette dépense n'était pas prévisible. À ne pas confondre avec le statut : une dépense peut être prévisionnelle et prévue (le loyer du mois prochain), réelle et imprévue (le plombier de mardi). Rien ne change à tes soldes ni à tes totaux — c'est une étiquette, que seule l'extension « Budget » regarde.",

  /* ----- Rapprocher une prévisionnelle de la vraie ----- */
  "noyau.import-previsionnelles":
    "Ces lignes du relevé correspondent à des dépenses que tu avais écrites d'avance, en prévisionnel. Plutôt que d'ajouter une opération de plus à côté de la prévision, l'import va REMPLACER la prévision par la vraie ligne : même opération, désormais réelle, avec la date et le montant du relevé. Elle garde tout ce qui lui était rattaché — son projet, son profil de remboursement, sa récurrence. Coché, le remplacement a lieu ; décoché, la ligne s'importe comme une autre et la dépense prévue reste telle quelle. Vérifie la colonne de droite avant de confirmer : c'est elle qui dit ce qui sera écrasé. Et si tu te trompes, annuler l'import rend chaque prévision à son état d'origine.",
  "noyau.rapprochement":
    "Une dépense prévue sert à voir venir ; encore faut-il qu'elle disparaisse quand la vraie arrive. Coche cette case et l'import la reconnaîtra au relevé : il te proposera alors de la REMPLACER par la vraie ligne, au lieu d'ajouter une seconde opération à côté. Il te demande toujours avant de le faire, et rien n'est perdu si tu refuses. L'app la reconnaît à son COMPTE, son MONTANT (au centime près) et sa DATE ; les deux dates ci-dessous disent dans quel intervalle tu l'attends — utile quand tu connais le mois d'un prélèvement sans en connaître le jour. Elles doivent tomber dans le même mois, et se laissent vides si tu l'attends au jour dit.",
  "noyau.rapprochement-mots-cles":
    "Facultatifs, et inutiles la plupart du temps : le compte, le montant et la date suffisent. Ils servent au cas inverse — deux prélèvements du même montant le même mois, que seul le libellé distingue. Tous doivent se retrouver dans le libellé de la ligne importée ; la casse et les accents n'ont pas d'importance.",

  "noyau.montant-a-rembourser":
    "Sur une dépense remboursable, ce qu'on te rendra : au plus ce que tu as avancé. Sur un prêt reçu, ce que tu rendras : au moins ce qu'on t'a remis — l'écart est l'intérêt du prêt.",
  "noyau.notes-2":
    "Un commentaire non lu par l'app. Sur un virement, il vaut pour les deux comptes.",
  "noyau.comptes":
    "Double-clique une ligne pour modifier un compte, fais-la glisser d'une carte à l'autre pour changer son type.",
  "noyau.monnaies-du-compte":
    "Chaque monnaie du compte garde son propre solde, jamais mélangé aux autres — d'où un solde initial par monnaie.",
  "noyau.categories-de-depenses":
    "Les catégories dans lesquelles tes dépenses se rangent : leur nom, et l'ordre dans lequel tu les vois partout ailleurs. Ce qu'on LEUR ALLOUE — le budget d'un mois, la part qu'elles devraient peser — se règle sur la page Budget, où elles se voient toutes ensemble. « Autres » ne peut ni être renommée ni supprimée : c'est elle qui recueille les opérations d'une catégorie qu'on efface.",
  "noyau.categorie-entree":
    "Coche si les opérations que tu ranges ici sont de l'argent qui RENTRE : un salaire, des loyers perçus, une allocation. L'app leur donnera le sens « entrée », ne leur dessinera pas de barre dans l'histogramme des dépenses — elle y resterait à zéro — et ne te demandera pas de budget sur la page Budget. Les opérations DÉJÀ écrites ne bougent pas : leur sens a été posé à leur création, et le réécrire ferait bouger des soldes que tu as peut-être déjà rapprochés de ton relevé.",
  "noyau.correspondances-memorisees":
    "Tout ce que l'app a retenu de tes imports : un libellé rangé une fois dans une catégorie y repart tout seul les fois suivantes.",
  "noyau.categories-bancaires":
    "Chaque libellé de tes relevés, sous la catégorie où il part. Fais-en glisser un dans une autre colonne pour le reclasser. Entre parenthèses, le compte d'où vient le relevé.",
  "noyau.comptes-bancaires":
    "Les noms de compte lus dans tes relevés, et le compte de l'app en face. Une entrée partagée par plusieurs presets les met tous à jour.",
  "noyau.devises":
    "Les libellés de devise de tes relevés (« EUR »), et la monnaie de l'app en face. Vide si aucun preset ne lit de colonne de devise.",
  "noyau.preset":
    "Tout ce qui est propre au format d'une banque : colonnes à lire, libellés déjà rangés, lignes déjà importées. Un preset par banque.",
  "noyau.compte-bancaire-de-ce-preset":
    "Toutes les lignes du fichier iront sur ce compte. Laisse « aucun » si le fichier nomme lui-même le compte de chaque ligne.",
  "noyau.configuration-du-fichier":
    "Quelle colonne de ton fichier porte quelle information. Date, Nature et Montant sont obligatoires ; le reste est dans « Configuration avancée ».",
  "noyau.colonnes-lues":
    "Clique sur l'œil pour lire ou ignorer une colonne. Date, Nature et Montant sont obligatoires et ne s'éteignent pas.",
  "noyau.configuration-avancee":
    "Pour ce que ton relevé dit en plus : le compte, le sens, les devises, les frais. Laisse vide si ton relevé tient dans une seule colonne de montant et une seule monnaie. Le « i » de chaque ligne dit à quoi elle sert.",
  "noyau.reglages-de-lecture":
    "À régler seulement si le fichier est mal lu : colonnes mélangées, montants illisibles. L'app devine seule dans la plupart des cas.",
  "noyau.le-fichier-tel-qu-il-est":
    "Les colonnes colorées sont celles que l'app va lire, les grises sont ignorées. Deux façons de corriger un décalage : glisser un en-tête sur un autre pour échanger les deux colonnes, ou saisir les numéros dans « Configuration du fichier » au-dessus.",
  "noyau.categories-bancaires-a-confirmer":
    "Un libellé que l'app ne connaît pas encore atterrit dans « Autres » : coche « Confirmer » pour le laisser là, ou choisis une autre catégorie. Rien ne presse — tu peux aller créer une catégorie ailleurs dans l'app et revenir, l'import t'attend.",
  "noyau.apercu-import":
    "Les doublons repérés sont déjà cochés. Tant qu'il en reste de cochés, l'import attend : supprime-les, ou décoche ceux que tu veux importer quand même. « Modifier » sert aussi à changer le type d'une ligne.",
  "noyau.ressemblances":
    "Ce virement est peut-être déjà en base. Quand tu importes les relevés de tes deux banques, le même virement apparaît des deux côtés, écrit de deux façons différentes. L'app compare ici la transaction elle-même — le compte, les devises, le montant, une date proche — et te montre à quoi chaque ligne ressemble. Rien n'est bloqué ni coché d'avance : toi seul sais si tu as vraiment viré deux fois.",
  "noyau.doublons-detectes":
    "Ces lignes sont identiques à des lignes déjà importées : chacune est suivie de celle qu'elle recopie. Elles sont cochées pour être écartées d'un clic — décoches-en une pour l'importer quand même, deux achats identiques le même jour ça arrive.",
  "noyau.lignes-entete":
    "Combien de lignes, en tête du fichier, ne sont pas des opérations : les intitulés de colonnes, mais aussi le nom du titulaire, le numéro de compte ou une ligne vide que certaines banques écrivent avant. Laisse 0 si le fichier commence directement par une opération.",
  "noyau.comparaison-des-doublons":
    "Comment l'app reconnaît une ligne déjà importée. Soit toutes les colonnes moins celles qui bougent d'un export à l'autre (solde courant, référence), soit les seules qui identifient une ligne — souvent date + libellé + montant.",
  "noyau.mots-cles-de-la-colonne-sens":
    "Les mots que ta banque emploie pour dire qu'une ligne sort ou entre. Ajoute-les un par un avec « + » ou Entrée ; majuscules et accents sont ignorés. Retenus avec le preset. Laisse vide pour garder les mots-clés reconnus par défaut, rappelés sous chaque champ : dès que tu en ajoutes un, il remplace toute la liste par défaut de ce sens-là.",
  "noyau.mots-cles-de-la-colonne-etat":
    "Les mots que ta banque emploie pour dire où en est une opération, même fonctionnement qu'au-dessus. Un mot inconnu met la ligne en erreur plutôt que d'être deviné. Laisse vide pour garder les mots-clés reconnus par défaut : dès que tu en ajoutes un, il remplace toute la liste par défaut de cet état-là.",
  "noyau.devises-a-faire-correspondre":
    "Ton relevé écrit « EUR », l'app connaît les monnaies que tu as nommées. Dis-le une fois, c'est retenu pour la suite.",
  "noyau.devises-deja-rattachees":
    "Ces libellés ont déjà leur correspondance : rien à faire, c'est là pour vérifier avant de confirmer.",
  "noyau.historique-des-importations":
    "Annuler un import retire les opérations qu'il avait créées, celles que tu as modifiées depuis comprises. Le fichier redevient importable.",
  "noyau.extensions":
    "Une extension ajoute une fonctionnalité. La désactiver fait disparaître son écran sans rien effacer — tout revient si tu la rallumes.",
  "noyau.base-de-donnees":
    "L'application lit et écrit dans un seul fichier .db. Tu choisis où il vit ; l'emplacement est retenu d'un lancement à l'autre. « Basculer » exige un fichier existant ; « Créer / déplacer ici » accepte un chemin neuf, et y déplace la base ouverte si elle est encore dans le dossier de l'application. Une base restée à une version de schéma antérieure est mise à jour à la bascule, après copie horodatée à côté du fichier d'origine. Le bouton « Parcourir » ne pré-remplit que le NOM du fichier : un navigateur ne transmet jamais le chemin complet, complète le dossier à la main.",

  /* ----- Extension « Import de placements » ----- */
  "import-placements.format-du-fichier":
    "Un preset par courtier : colonnes à lire et vocabulaire de ses relevés. Ceux des relevés bancaires vivent à part, sur la page Import.",
  "import-placements.compte-de-placements-de-ce-preset":
    "Un relevé de courtier ne dit jamais quel compte il décrit. Le lier ici évite de le choisir à chaque import ; laisse vide si plusieurs comptes ont le même format.",
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
    "Saisis ce que la banque t'a réellement versé, tel que le relevé l'annonce. Rien n'est calculé à ta place : un taux annuel ne peut pas retrouver le bon chiffre quand il change en cours d'année. Seuls les comptes d'épargne sont ici. Ces montants S'AJOUTENT AU SOLDE du compte, sans être écrits en opération : ils n'apparaissent donc pas dans la page Opérations et ne pèsent sur aucun flux du mois. ATTENTION SI TON RELEVÉ LES PORTE AUSSI : importer la ligne d'intérêts après l'avoir saisie ici compterait la somme deux fois — saisis-la ici, ou importe-la, pas les deux.",

  /* ----- Extension « Vue d'ensemble des placements » ----- */
  "investing-overview.repartition-par-classe":
    "À QUOI ton portefeuille expose, quelle que soit la façon dont tu le détiens : actions, obligations, immobilier, monétaire. C'est la question à laquelle le graphe du dessus ne peut pas répondre — un ETF obligataire y compte comme un ETF, pas comme de l'obligataire. Ce disque n'apparaît que si tu as classé au moins un titre.",
  "investing-overview.repartition-par-type-de-titre":
    "COMMENT ton portefeuille est détenu : la part qui passe par des ETF, celle que tu as choisie titre par titre, celle qui est en SCPI. À la valeur d'aujourd'hui, tous comptes confondus. Survole une part pour voir les titres qui la composent.",

  /* ----- Extension « Monnaies » ----- */
  "monnaies.monnaies":
    "Chaque monnaie garde ses propres soldes et budgets, jamais mélangés aux autres. Le symbole est ce qui s'affiche à côté des montants.",
  "monnaies.taux-de-change":
    "Ce que vaut une monnaie dans une autre. Sert uniquement à la case « tout convertir » du dashboard, et ne modifie aucun montant enregistré. Un seul sens par couple suffit, l'inverse se calcule.",

  /* ----- Extension « Placements » ----- */
  "placements.titres-suivis":
    "Tes titres, communs à tous tes comptes : le même ETF peut être détenu sur deux comptes. Le cours se saisit à la main, ou se relit en ligne avec l'extension Lecture de cours. Il ne sert qu'à la valorisation, jamais à un solde.",
  "placements.afficher-les-titres-archives":
    "Archiver, c'est ranger, pas effacer : le titre quitte les listes, son historique reste. C'est ici qu'on le remet en service.",
  "placements.enveloppe":
    "Comment ce titre est détenu : un ETF, une action que tu as choisie toi-même, une SCPI. Facultatif, et modifiable à tout moment.",
  "placements.classe-actif":
    "À quoi ce titre expose : actions, obligations, immobilier… C'est l'autre question, et elle ne se déduit pas de la première — un ETF obligataire est un ETF (enveloppe) et de l'obligataire (classe). Facultatif.",
  "placements.types-de-titre":
    "COMMENT tes titres sont détenus : ETF, action en direct, fonds, SCPI. Tes propres étiquettes, que tu nommes comme tu veux. À ne pas confondre avec la classe d'actif juste en dessous, qui dit à QUOI ils exposent — un ETF obligataire est un ETF et de l'obligataire. Purement descriptif : aucun solde ni aucune valorisation n'en dépend.",
  "placements.classes-actif":
    "À QUOI tes titres exposent, quelle que soit la façon dont tu les détiens. Cinq classes sont livrées parce que ce vocabulaire est le même pour tout le monde, contrairement aux enveloppes que chacun nomme à sa façon ; renomme-les et supprime-les librement. Purement descriptif, comme tout le reste ici.",

  /* ----- Extension « Objectifs » ----- */
  "objectifs.objectifs":
    "Les règles que tu te donnes et que le budget ne sait pas écrire. Une enveloppe compte des euros dépensés, un objectif de répartition une part du total : ni l'un ni l'autre ne sait dire « pas plus de quatre sorties par semaine » ni « mes courses ne devraient pas dépasser 40 € en moyenne ». Un objectif mesure ce que tu veux suivre, le compare à une cible, et ne refuse jamais rien — il constate. Les périodes ci-dessus disent seulement sur quoi tu regardes : un objectif n'a pas de mois, il a une cadence.",
  "objectifs.mesure":
    "Quatre mesures, et elles ne se calculent pas sur le même périmètre. MONTANT TOTAL et PART DES DÉPENSES se lisent exactement comme l'histogramme et le camembert du dashboard : une dépense amortie n'y compte que pour la part du mois, une remboursable pour ce qui te reste à charge. NOMBRE DE DÉPENSES et MONTANT MOYEN comptent des lignes de relevé : une dépense, à sa date, pour son montant — un compte ne s'étale pas, et une moyenne doit valoir ce que tu lis sur ton relevé.",
  "objectifs.cadence":
    "L'unité dans laquelle ta cible est écrite, et rien d'autre : elle ne décide pas de ce que tu regardes. Quand la période affichée tient dans une cadence — un objectif mensuel lu sur un mois — tu lis ton CUMUL face à ta cible : « 196 € sur 250 € » le 19 du mois, et rien n'est prédit de ce que tu dépenseras d'ici au 30. Quand elle en contient plusieurs — un objectif hebdomadaire lu sur un mois — c'est une MOYENNE sur le temps déjà écoulé : « 3,8 par semaine », et c'est ce chiffre-là qui se compare à ta cible.",
  "objectifs.visible-dashboard":
    "Les objectifs cochés s'affichent sous les graphes du dashboard, sur la période et la monnaie que tu y regardes. Les autres restent ici. C'est devant tes dépenses du mois qu'on se demande si on tient sa règle — mais un bloc qui grandit sans fin finirait par repousser les graphes hors de l'écran.",
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

/** Le texte d'une clé, ou la clé elle-même si elle est inconnue. */
function texteAide(cle) {
  return TEXTES[cle] !== undefined ? TEXTES[cle] : cle;
}
