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
  "noyau.touche-gel-infobulle":
    "Clique dans le champ, puis appuie sur la touche (ou la combinaison) que tu veux. Elle est enregistrée aussitôt. Elle n'agit jamais pendant que tu écris dans un champ de saisie, pour ne pas t'empêcher de taper la lettre elle-même.",
  "noyau.gel-infobulle-aide":
    "L'infobulle des graphes suit le curseur et disparaît dès qu'on le retire : tout ce qu'elle contient doit donc se lire sans bouger la souris. Cette touche la FIGE là où elle est — le survol des graphes cesse de la remplacer, et tu récupères ton curseur pour lire son top 3 ou cliquer son bouton tranquillement. La même touche, un clic à côté ou Échap la libèrent.",

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
  /* ----- Rapprocher une prévisionnelle de la vraie ----- */
  "noyau.import-previsionnelles":
    "Ces lignes du relevé correspondent à des dépenses que tu avais écrites d'avance, en prévisionnel. Plutôt que d'ajouter une opération de plus à côté de la prévision, l'import va REMPLACER la prévision par la vraie ligne : même opération, désormais réelle, avec la date et le montant du relevé. Elle garde tout ce qui lui était rattaché — son projet, son profil de remboursement, sa récurrence.",
  "noyau.import-previsionnelles-aide":
    "Coché, le remplacement a lieu. Décoché, la ligne s'importe comme n'importe quelle autre et la dépense prévue reste telle quelle — tu te retrouves simplement avec les deux, comme avant. Vérifie la colonne de droite avant de confirmer : c'est elle qui dit ce qui sera écrasé. Et si tu te trompes, annuler l'import rend chaque prévision à son état d'origine.",
  "noyau.rapprochement":
    "Une dépense prévue sert à voir venir ; encore faut-il qu'elle disparaisse quand la vraie arrive. Coche cette case et l'import la reconnaîtra au relevé : il te proposera alors de la REMPLACER par la vraie ligne, au lieu d'ajouter une seconde opération à côté. Il te demande toujours avant de le faire, et rien n'est perdu si tu refuses.",
  "noyau.rapprochement-aide":
    "L'app reconnaît la vraie dépense à son COMPTE, son MONTANT (au centime près) et sa DATE. Les deux dates ci-dessous disent dans quel intervalle tu l'attends — utile quand tu connais le mois d'un prélèvement sans en connaître le jour, ou quand ta banque passe au 6 ce qu'elle annonçait au 5. Les deux doivent tomber dans le même mois. Laisse-les vides si tu l'attends au jour dit.",
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
    "Un budget vaut pour un mois et une monnaie, choisis par les onglets ci-dessous ; un mois non rempli reprend le dernier renseigné. L'œil de la colonne Dashboard ne fait qu'afficher ou masquer la catégorie dans l'histogramme.",
  "noyau.objectif":
    "La PART que cette catégorie devrait représenter dans tes dépenses, en pourcentage. Rien à voir avec le budget en valeur posé à gauche : les deux sont indépendants, on peut poser l'un sans l'autre. Ne dépend ni du mois ni de la monnaie. Il s'affiche sur le camembert du dashboard, à droite de la part réellement constatée. Vide = aucun objectif.",
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
  "noyau.comparaison-des-doublons":
    "Comment l'app reconnaît une ligne déjà importée. Soit toutes les colonnes moins celles qui bougent d'un export à l'autre (solde courant, référence), soit les seules qui identifient une ligne — souvent date + libellé + montant.",
  "noyau.mots-cles-de-la-colonne-sens":
    "Les mots que ta banque emploie pour dire qu'une ligne sort ou entre. Ajoute-les un par un avec « + » ou Entrée ; majuscules et accents sont ignorés. Retenus avec le preset.",
  "noyau.mots-cles-de-la-colonne-etat":
    "Les mots que ta banque emploie pour dire où en est une opération, même fonctionnement qu'au-dessus. Un mot inconnu met la ligne en erreur plutôt que d'être deviné.",
  "noyau.devises-a-faire-correspondre":
    "Ton relevé écrit « EUR », l'app connaît les monnaies que tu as nommées. Dis-le une fois, c'est retenu pour la suite.",
  "noyau.devises-deja-rattachees":
    "Ces libellés ont déjà leur correspondance : rien à faire, c'est là pour vérifier avant de confirmer.",
  "noyau.historique-des-importations":
    "Annuler un import retire les opérations qu'il avait créées, celles que tu as modifiées depuis comprises. Le fichier redevient importable.",
  "noyau.extensions":
    "Une extension ajoute une fonctionnalité. La désactiver fait disparaître son écran sans rien effacer — tout revient si tu la rallumes.",
  "noyau.base-de-donnees":
    "L'application lit et écrit dans un seul fichier .db. Tu choisis où il vit ; l'emplacement est retenu d'un lancement à l'autre.",
  "noyau.une-part-pas-un-montant-elle-vaut-pour-tous":
    "Une part, pas un montant : elle vaut pour tous les mois et toutes les monnaies. 0 = aucun objectif.",

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
    "Une règle reconnaît une ligne à son libellé et dit ce qu'elle est : achat, vente, transfert d'espèces. Elle vaut pour tous tes courtiers et passe avant les mots-clés du preset.",
  "import-placements.description":
    "Note libre : pourquoi cette règle existe, quel relevé l'a rendue nécessaire. Jamais lue par l'application.",
  "import-placements.avec-le-compte-en-face":
    "L'autre compte : celui d'où vient l'argent versé, ou celui où va l'argent retiré. Le sens se déduit du signe du montant. Sans lui, la ligne est à compléter à la main dans l'aperçu.",
  "import-placements.et-type-le-titre-en":
    "Une étiquette posée sur le titre que la ligne désigne — ETF, obligation, action. Uniquement à la création d'un titre : un titre déjà typé garde le sien. Purement descriptif.",

  /* ----- Extension « Intérêts perçus » ----- */
  "interets-percus.interets-percus":
    "Saisis ce que la banque t'a réellement versé, tel que le relevé l'annonce. Rien n'est calculé à ta place : un taux annuel ne peut pas retrouver le bon chiffre quand il change en cours d'année. Seuls les comptes d'épargne sont ici.",

  /* ----- Extension « Vue d'ensemble des placements » ----- */
  "investing-overview.repartition-par-type-de-titre":
    "La part de ton portefeuille en ETF, en obligations, en actions — à la valeur d'aujourd'hui, tous comptes confondus. Survole une part pour voir les titres qui la composent.",

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
  "placements.types-de-titre":
    "Tes propres étiquettes — ETF, action en direct, obligation, SCPI — pour regrouper les titres. Purement descriptif : aucun solde ni aucune valorisation n'en dépend.",

  /* ----- Extension « Projets » ----- */
  "projets.projets":
    "Rassemble des opérations déjà saisies, quelles que soient leur catégorie et leur compte, pour lire ce qu'un voyage ou un déménagement t'a coûté. Une opération peut appartenir à plusieurs projets, et rien d'autre dans l'app n'en tient compte.",
  "projets.repartition-par-categorie":
    "Les sorties du projet, réparties par catégorie — virements sortants compris, comme dans le total ci-dessus. Les entrées n'y figurent pas : elles se lisent dans le total des entrées.",
  "projets.ajouter-des-operations":
    "Ajouter une opération ici ne la retire d'aucun autre projet, et ne change ni sa catégorie ni son compte.",

  /* ----- Extension « Règles » ----- */
  "regles.regles-de-categorisation":
    "Une règle reconnaît des lignes à leur libellé et dit ce qu'elles sont : virement interne, prêt, dépense remboursable… Elle peut aussi poser la catégorie, et passe avant tout le reste.",
  "regles.description":
    "Note libre : pourquoi cette règle existe, quel relevé l'a rendue nécessaire, ce qu'il faudra vérifier si elle cesse de mordre. Jamais lue par l'application.",
  "regles.decouper-entre-plusieurs-categories":
    "La règle répartit le montant de la ligne entre plusieurs catégories, au lieu d'en poser une seule. Réservé aux opérations classiques.",
  "regles.avec-le-compte-en-face":
    "L'autre compte du virement, celui que le relevé ne nomme pas. Le sens se déduit du signe du montant. Sans lui, la ligne est à compléter à la main dans l'aperçu.",
  "regles.arreter-la-lecture-des-regles-ici":
    "Coché, le réglage habituel : cette règle décide, on s'arrête là. Décoché, les règles suivantes peuvent compléter ce qu'elle laisse ouvert — la catégorie, le compte en face. Le type reste celui de la première règle qui a mordu.",

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
