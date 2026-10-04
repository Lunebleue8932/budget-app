/**
 * PORTUGAIS (BRÉSIL). Même chantier que l'anglais : le français est la clé, la
 * traduction passe par `t()` et par le parcours du DOM statique (cf. i18n.js).
 *
 * CHARGÉ APRÈS i18n.js, et avant app.js : il ne fait qu'AJOUTER la langue au
 * dictionnaire (`TRADUCTIONS.pt`) et ses motifs de messages serveur
 * (`MOTIFS_PAR_LANGUE.pt`). Un fichier à part plutôt que quatre mille lignes de
 * plus dans i18n.js : les deux langues se relisent et se corrigent chacune de leur
 * côté.
 *
 * VOCABULAIRE, pour qui y retouche : Paramètres → « Ajustes », Opération →
 * « transação », Objectif → « meta », Cible → « alvo », Enveloppe (de titre) →
 * « veículo », Amorti → « diluído », Relevé → « extrato », Preset →
 * « predefinição », Infobulle → « dica ». Les nombres et les dates gardent le
 * format français : c'est aussi ce que fait l'anglais.
 */

TRADUCTIONS.pt = {
  "Rechercher dans la page (Ctrl+F)":
    "Pesquisar nesta página (Ctrl+F)",
  "Rechercher":
    "Pesquisar",
  "Rechercher dans la page…":
    "Pesquisar nesta página…",
  "Rechercher dans la page":
    "Pesquisar nesta página",
  "Correspondance précédente (Maj+Entrée)":
    "Resultado anterior (Shift+Enter)",
  "Correspondance précédente":
    "Resultado anterior",
  "Correspondance suivante (Entrée)":
    "Próximo resultado (Enter)",
  "Correspondance suivante":
    "Próximo resultado",
  "Opérations":
    "Transações",
  "Placements financiers":
    "Investimentos",
  "Paramètres":
    "Ajustes",
  "Solde total":
    "Saldo total",
  "projeté":
    "projetado",
  "Comptes":
    "Contas",
  "Variation sur le mois brute":
    "Variação bruta do mês",
  "Variation sur l'année brute":
    "Variação bruta do ano",
  "Variation attribuée au mois":
    "Variação atribuída ao mês",
  "Variation attribuée à l'année":
    "Variação atribuída ao ano",
  "Voir toutes les dépenses":
    "Ver todas as despesas",
  "Total":
    "Total",
  "Part":
    "Participação",
  "État actuel":
    "Estado atual",
  "Lier":
    "Vincular",
  "liée à {n}":
    "vinculada a {n}",
  "« {nature} » sera liée à {n} opération(s) à la confirmation.":
    "« {nature} » será vinculada a {n} transação(ões) na confirmação.",
  "Budgets par catégorie":
    "Orçamentos por categoria",
  "Une valeur par catégorie, lue de deux façons. -- LE CURSEUR répartit ; les deux cases à sa droite montrent la même enveloppe en monnaie et en part du budget du mois. Bouger le curseur met les deux à jour. -- ÉCRIRE DANS L'UNE recalcule l'autre et replace le curseur. Ctrl+Entrée, ou un clic ailleurs, enregistre. -- L'ENVELOPPE répond à « combien puis-je encore dépenser là » : c'est elle que trace le trait rouge de l'histogramme du dashboard. La PART répond à « quelle portion de mon budget y va » : c'est elle que le camembert affiche en vue Budget. -- La somme des parts ne peut pas dépasser 100 %, donc la somme des enveloppes ne peut pas dépasser le budget du mois. Au-delà, la saisie est refusée et le message dit le plafond utilisable. -- Sans budget du mois posé, la case des parts n'a pas de dénominateur : elle reste éteinte, et seule l'enveloppe s'enregistre.":
    "Um valor por categoria, lido de duas formas. -- O CONTROLE DESLIZANTE distribui; as duas caixas à direita mostram o mesmo envelope em moeda e em parte do orçamento do mês. Mover o controle atualiza as duas. -- ESCREVER EM UMA recalcula a outra e reposiciona o controle. Ctrl+Enter, ou um clique fora, salva. -- O ENVELOPE responde a « quanto ainda posso gastar aí »: é ele que a linha vermelha do histograma do painel traça. A PARTE responde a « que fatia do meu orçamento vai para lá »: é ela que o gráfico de pizza mostra na visão Orçamento. -- A soma das partes não pode passar de 100 %, portanto a soma dos envelopes não pode passar do orçamento do mês. Além disso, a entrada é recusada e a mensagem indica o teto utilizável. -- Sem orçamento do mês definido, a caixa das partes não tem denominador: fica desativada, e só o envelope é salvo.",
  "Budget du mois":
    "Orçamento do mês",
  "Budget de la catégorie":
    "Orçamento da categoria",
  "Part du budget":
    "Parte do orçamento",
  "sur":
    "de",
  "hérité":
    "herdado",
  "Budget du mois enregistré.":
    "Orçamento do mês salvo.",
  "Montant invalide.":
    "Valor inválido.",
  "Ces chiffres ne s'accordent pas":
    "Estes números não batem",
  "Laisser tel quel":
    "Deixar como está",
  "au lieu de":
    "em vez de",
  "Mettre le budget à":
    "Definir o orçamento como",
  "Mettre l'objectif à":
    "Definir a meta como",
  "Mettre le budget du mois à":
    "Definir o orçamento do mês como",
  "Paramètres généraux":
    "Ajustes gerais",
  "Touche qui fige l'infobulle":
    "Tecla que congela a dica",
  "Clique ici, puis appuie sur la touche":
    "Clique aqui e pressione a tecla",
  "Touche par défaut":
    "Tecla padrão",
  "Désactiver":
    "Desativar",
  "Désactivé":
    "Desativada",
  "Touche enregistrée.":
    "Tecla salva.",
  "Figée — {touche} ou Échap pour libérer":
    "Congelada — {touche} ou Esc para liberar",
  "Versé":
    "Pago",
  "Supprimer ce versement":
    "Excluir este pagamento",
  "Aucun compte d'épargne. Crée-en un depuis Paramètres → Comptes en choisissant le type « épargne », puis reviens ici.":
    "Nenhuma conta poupança. Crie uma em Ajustes → Contas escolhendo o tipo « poupança », depois volte aqui.",
  "Depuis un lien":
    "A partir de um link",
  "Cette base est dans le dossier de l'application ({dossier}). Une mise à jour la remplacera : déplace-la ailleurs, par exemple {propose}.":
    "Este banco de dados está na pasta do aplicativo ({dossier}). Uma atualização o substituirá: mova-o para outro lugar, por exemplo {propose}.",
  "La base retenue au dernier lancement est introuvable : {chemin}. L'application est repartie sur son emplacement par défaut — rien n'a été effacé, le fichier est simplement ailleurs (disque débranché, dossier renommé).":
    "O banco de dados usado na última abertura não foi encontrado: {chemin}. O aplicativo voltou ao local padrão — nada foi apagado, o arquivo está apenas em outro lugar (disco desconectado, pasta renomeada).",
  "Build de test construit en local : cette copie ouvre toujours sa propre base de test et n'écrit jamais dans la configuration de l'application. Changer de base ne vaut que pour cette session. Supprime le fichier BUILD-DE-TEST.txt à côté de l'exécutable pour qu'elle se comporte comme une version publiée.":
    "Build de teste feito localmente: esta cópia sempre abre o próprio banco de teste e nunca grava na configuração do aplicativo. Trocar de banco só vale para esta sessão. Apague o arquivo BUILD-DE-TEST.txt ao lado do executável para que ela se comporte como uma versão publicada.",
  "Serveur de développement : la base de l'application est celle du dépôt, et rien n'est écrit dans la configuration. Changer de base ne vaut que pour cette session.":
    "Servidor de desenvolvimento: o banco do aplicativo é o do repositório, e nada é gravado na configuração. Trocar de banco só vale para esta sessão.",
  "Ce choix n'a pas pu être enregistré : il ne vaudra que pour cette session.":
    "Não foi possível salvar esta escolha: ela só valerá para esta sessão.",
  "Aucune correspondance de catégorie mémorisée.":
    "Nenhuma correspondência de categoria memorizada.",
  "Aucune correspondance de compte mémorisée.":
    "Nenhuma correspondência de conta memorizada.",
  "Aucune règle pour le moment : les lignes importées resteront à classer à la main.":
    "Nenhuma regra por enquanto: as linhas importadas continuarão a ser classificadas à mão.",
  "Ajoute d'abord un titre dans « Titres suivis » ci-dessous.":
    "Adicione primeiro um título em « Títulos acompanhados » abaixo.",
  "À utiliser si le fichier n'est pas lu correctement (colonnes mélangées, montants illisibles) : la détection automatique du délimiteur et de la virgule décimale française ne convient pas à tous les formats d'export.":
    "Use se o arquivo não for lido corretamente (colunas misturadas, valores ilegíveis): a detecção automática do delimitador e da vírgula decimal francesa não serve para todos os formatos de exportação.",
  "— l'endroit qu'une mise à jour remplace. Choisis-lui une place ailleurs : ce sera fait une fois pour toutes.":
    "— o lugar que uma atualização substitui. Escolha outro lugar para ele: isso será feito uma vez por todas.",
  "intérêts 2025":
    "juros 2025",
  "Ajoute, renomme et supprime des monnaies, pour suivre des comptes et des budgets dans plusieurs devises. Chaque solde reste suivi séparément ; une case du dashboard permet, si tu as saisi un taux, de tout ramener à une seule monnaie le temps d'un coup d'œil. Sans cette extension, l'application est mono-devise.":
    "Adiciona, renomeia e exclui moedas, para acompanhar contas e orçamentos em várias moedas. Cada saldo continua sendo acompanhado separadamente; uma caixa « Tout convertir » reúne tudo em uma única moeda, à taxa que você informar. Sem ela, o aplicativo usa uma única moeda.",
  "Ce que l'opération a coûté ou rapporté en espèces. C'est lui qui fait foi : le prix par titre vaut montant ÷ quantité, pas le cours annoncé. Ton solde colle ainsi au relevé, frais de courtage compris.":
    "O que a transação custou ou rendeu em dinheiro. É ELE que vale: o preço por título é valor ÷ quantidade, não a cotação anunciada. Seu saldo bate assim com o extrato, corretagem incluída.",
  "Ce que la ligne décrit : un achat, une vente, ou un transfert d'espèces. Les mots-clés se règlent juste en dessous. Un libellé inconnu met la ligne en erreur plutôt que d'être deviné.":
    "O que a linha descreve: uma compra, uma venda ou uma transferência de dinheiro. As palavras-chave são definidas logo abaixo. Uma descrição desconhecida coloca a linha em erro em vez de ser adivinhada.",
  "Ce qui PART du compte, avant frais et avant conversion ; « Montant » décrit alors ce qui ARRIVE. C'est le couple qu'il faut pour importer un virement entre deux devises : seul ton relevé connaît les deux montants.":
    "O que SAI da conta, antes das tarifas e da conversão; « Montant » descreve então o que CHEGA. É o par necessário para importar uma transferência entre duas moedas: só o seu extrato conhece os dois valores.",
  "Classe automatiquement les lignes d'un relevé d'après leurs libellés : type d'opération, catégorie, compte en face d'un virement. Vue liste ordonnée ou vue galerie par dossiers. Les règles restent en base quand l'extension est éteinte — l'import cesse simplement de les consulter.":
    "Classifica automaticamente as linhas de um extrato conforme suas descrições: tipo de transação, categoria, conta de destino de uma transferência. Visão em lista ordenada ou em galeria por pastas. As regras permanecem no banco quando a extensão está desligada — a importação apenas deixa de consultá-las.",
  "Le code ISIN du titre (FR0000120073, LU1681043599…). Seul nom qui ne change jamais : c'est par lui qu'un titre est reconnu d'un import à l'autre. Facultatif si tu lis le nom de la valeur.":
    "O código ISIN do título (FR0000120073, LU1681043599…). É o único nome que nunca muda: é por ele que um título é reconhecido de uma importação para a outra. Opcional se você ler o nome do ativo.",
  "Le montant de la ligne, avec son signe : négatif il sort, positif il entre. Si ton relevé sépare sorties et entrées en deux colonnes, éteins celle-ci et règle « Montant au débit » et « Montant au crédit ».":
    "O valor da linha, com o sinal: negativo sai, positivo entra. Se o seu extrato separa saídas e entradas em duas colunas, desligue esta e configure « Montant au débit » e « Montant au crédit ».",
  "Le nom du titre tel que ton courtier l'écrit. Facultatif si tu lis l'ISIN, mais il faut l'un des deux : sans eux, une ligne d'achat ne dit pas de quelle valeur elle parle.":
    "O nome do título como a sua corretora o escreve. Opcional se você ler o ISIN, mas é preciso um dos dois: sem eles, uma linha de compra não diz de qual ativo se trata.",
  "Le prix par titre annoncé par le relevé. Il ne décide de rien, il sert de contrôle : un écart de plus de 1 % avec le montant divisé par la quantité est signalé au-dessus de l'aperçu, sans bloquer l'import.":
    "O preço por título anunciado pelo extrato. Ele não decide nada, serve de verificação: uma diferença de mais de 1 % em relação ao valor dividido pela quantidade é sinalizada acima da pré-visualização, sem bloquear a importação.",
  "Les frais prélevés par la banque. C'est leur DEVISE qui décide auquel des deux montants ils se rapportent : dans la monnaie envoyée ils s'y ajoutent, dans celle reçue ils s'en retranchent. Dans une troisième, l'import est refusé plutôt que de fausser un solde.":
    "As tarifas cobradas pelo banco. É a MOEDA delas que decide a qual dos dois valores se referem: na moeda enviada elas se somam, na recebida elas são subtraídas. Em uma terceira, a importação é recusada em vez de falsear um saldo.",
  "Note ce que chaque compte d'épargne t'a RÉELLEMENT rapporté : un montant, une date, tels que le relevé les annonce. Les totaux se font par année et par monnaie, jamais deux devises additionnées. Remplace le système de taux d'intérêt : un taux annuel et une fréquence ne pouvaient reconstituer le bon chiffre que si l'app connaissait tous les mouvements du compte depuis son ouverture, et divergeaient du relevé dès qu'un taux changeait en cours d'année ou qu'un import était partiel. Aucun intérêt n'est écrit en opération : c'est un suivi d'affichage, qui ne touche ni aux soldes ni au dashboard. S'ouvre depuis la page Comptes, au-dessus des comptes d'épargne.":
    "Registra o que cada conta poupança RENDEU DE FATO: um valor, uma data, como o extrato os anuncia. Os totais são feitos por ano e por moeda, nunca somando duas moedas. Substitui o sistema de taxa de juros: uma taxa anual e uma frequência só reconstituíam o número certo se o app conhecesse todos os movimentos da conta desde a abertura, e divergiam do extrato assim que uma taxa mudava no meio do ano ou que uma importação era parcial. Nenhum juro é gravado como transação: é um acompanhamento de exibição, que não toca nos saldos nem no painel. Abre a partir da página Contas, acima das contas poupança.",
  "Le compte émetteur et le compte récepteur doivent être différents, sauf pour une":
    "A conta de origem e a conta de destino devem ser diferentes, exceto para uma",
  "Renseigne le montant reçu : les deux comptes sont dans des monnaies différentes":
    "Informe o valor recebido: as duas contas estão em moedas diferentes",
  "Générée automatiquement par une opération récurrente : modifie ou arrête la récurrence":
    "Gerada automaticamente por uma transação recorrente: edite ou interrompa a recorrência",
  "« Autres » ne peut pas être renommée : c'est la catégorie de repli.":
    "« Autres » não pode ser renomeada: é a categoria de reserva.",
  "Les colonnes ont changé depuis la dernière lecture. Relire le fichier pour voir ce que":
    "As colunas mudaram desde a última leitura. Releia o arquivo para ver o que",
  "l'import donnera, puis « Enregistrer la configuration » pour garder cet ordre dans le":
    "a importação dará, depois « Enregistrer la configuration » para manter esta ordem na",
  "Tes comptes et tes opérations vivent dans un seul fichier. Il est pour l'instant":
    "Suas contas e suas transações vivem em um único arquivo. Por enquanto ele está",
  "remplace. Choisis-lui une place ailleurs : ce sera fait une fois pour toutes.":
    "substitui. Escolha outro lugar para ele: isso será feito uma vez por todas.",
  "Aucun compte de placements financiers. Crée-en un depuis la page Comptes en choisissant":
    "Nenhuma conta de investimentos. Crie uma na página Contas escolhendo",
  "Ce fichier est-il une PHOTOGRAPHIE du compte (une ligne par titre détenu) ? OK : photographie. Annuler : liste d'opérations (achats, ventes, transferts).":
    "Este arquivo é uma POSIÇÃO da conta (uma linha por título em carteira)? OK: posição. Cancelar: lista de transações (compras, vendas, transferências).",
  "le type \"Placements financiers\", puis alimente-le par un virement interne.":
    "o tipo \"Placements financiers\", depois alimente-a com uma transferência interna.",
  "Supprimer « {nom} » ? Les {n} titre(s) qui le portent perdront leur type.":
    "Excluir « {nom} »? Os {n} título(s) que o carregam perderão o tipo.",
  "Non installée sur cette machine : le dossier de cette extension n'est pas présent ici.":
    "Não instalada nesta máquina: a pasta desta extensão não está presente aqui.",
  "Additionne tes monnaies en une seule, au taux que tu as saisi dans Paramètres → Monnaies. Rien n'est modifié : décoche et tout revient. Une monnaie sans taux est laissée de côté, et signalée.":
    "Soma suas moedas em uma só, à taxa que você informou em Ajustes → Moedas. Nada é modificado: desmarque e tudo volta. Uma moeda sem taxa é deixada de lado e sinalizada.",
  "La catégorie que ta banque a posée elle-même sur la ligne. Elle ne devient pas une catégorie de l'app toute seule : tu fais le rapprochement une fois, il est retenu.":
    "A categoria que o seu banco colocou na linha. Ela não vira uma categoria do app sozinha: você faz a correspondência uma vez e ela é memorizada.",
  "Le compte concerné, quand le fichier le nomme. Inutile si le preset est déjà lié à un compte : ce lien vaut pour toutes les lignes.":
    "A conta em questão, quando o arquivo a nomeia. Inútil se a predefinição já estiver ligada a uma conta: esse vínculo vale para todas as linhas.",
  "À régler seulement si ton relevé n'écrit que des montants positifs et dit à part si l'argent entre ou sort. Les mots-clés reconnus se règlent juste en dessous.":
    "Só vale a pena configurar se o seu extrato escreve apenas valores positivos e diz à parte se o dinheiro entra ou sai. As palavras-chave reconhecidas são definidas logo abaixo.",
  "La devise du montant. Sans elle, la ligne part dans la monnaie principale de son compte — faux dès qu'un compte en porte plusieurs.":
    "A moeda do valor. Sem ela, a linha vai para a moeda principal da conta — errado assim que uma conta tem várias.",
  "La devise du montant envoyé. Sans elle, l'app la suppose identique à celle du montant reçu, donc sans change.":
    "A moeda do valor enviado. Sem ela, o app a supõe idêntica à do valor recebido, portanto sem câmbio.",
  "La devise des frais, celle qui dit à quel montant ils s'appliquent. Sans elle, l'app les rattache au montant envoyé et te le signale à chaque import.":
    "A moeda das tarifas, a que diz a qual valor elas se aplicam. Sem ela, o app as associa ao valor enviado e avisa você a cada importação.",
  "Où en est l'opération chez ta banque. Une ligne en attente devient une opération prévisionnelle, une ligne refusée n'est pas importée. Les mots-clés se règlent plus bas.":
    "Em que pé está a transação no seu banco. Uma linha pendente vira uma transação prevista, uma linha recusada não é importada. As palavras-chave são definidas mais abaixo.",
  "Pour les relevés qui SÉPARENT sorties et entrées en deux colonnes, chaque ligne n'en remplissant qu'une. La colonne remplie dit le sens. Un zéro vaut une case vide, une ligne qui remplit les deux part en erreur.":
    "Para extratos que SEPARAM saídas e entradas em duas colunas, cada linha preenchendo apenas uma. A coluna preenchida indica o sentido. Um zero vale uma caixa vazia; uma linha que preenche as duas vai para erro.",
  "L'autre moitié : ce qui ENTRE. Elle va toujours avec « Montant au débit » — allumer ou éteindre l'une fait la même chose à l'autre.":
    "A outra metade: o que ENTRA. Ela sempre anda com « Montant au débit » — ligar ou desligar uma faz o mesmo com a outra.",
  "Le nombre de titres achetés ou vendus. Sans objet sur une ligne de transfert d'espèces, qui peut la laisser vide.":
    "O número de títulos comprados ou vendidos. Sem sentido em uma linha de transferência de dinheiro, que pode deixá-la vazia.",
  "L'étiquette du titre, si ton fichier la porte : ETF, obligation, action… Facultative, et sans effet sur un montant. Un libellé que tu n'as pas encore créé le sera à l'import. Un titre que l'app connaît déjà garde le type que tu lui as posé.":
    "O rótulo do título, se o seu arquivo o traz: ETF, título de renda fixa, ação… Opcional, e sem efeito sobre nenhum valor. Um rótulo que você ainda não criou será criado na importação. Um título que o app já conhece mantém o tipo que você definiu.",
  "Le nombre de titres que tu DÉTIENS au moment de la photographie. C'est cette quantité qui part en base : l'app ne sait pas comment tu y es arrivé, seulement ce que tu as.":
    "O número de títulos que você DETÉM no momento da posição. É essa quantidade que vai para o banco: o app não sabe como você chegou lá, apenas o que você tem.",
  "Ce qu'UN titre t'a coûté en moyenne, frais compris (le PRU). Par titre, pas le total investi. Si ton relevé donne le total, divise-le avant d'importer.":
    "O que UM título custou a você em média, tarifas incluídas (o preço médio). Por título, não o total investido. Se o seu extrato dá o total, divida-o antes de importar.",
  "Ce que la ligne vaut aujourd'hui, tous titres confondus. Elle ne crée aucune détention : elle sert à déduire le cours du titre (valeur ÷ quantité), que ce genre d'export ne donne pas.":
    "O que a linha vale hoje, todos os títulos somados. Ela não cria nenhuma posição: serve para deduzir a cotação do título (valor ÷ quantidade), que esse tipo de exportação não fornece.",
  "Suivi d'un portefeuille de titres : achat, vente, valorisation au dernier cours saisi et plus-values latentes, par compte de placements. Les cours sont saisis à la main — l'application ne consulte aucun service en ligne.":
    "Acompanhamento de uma carteira de títulos: compra, venda, valorização pela última cotação informada e ganhos latentes, por conta de investimentos. As cotações são informadas à mão — o aplicativo não consulta nenhum serviço online.",
  "Va lire un cours sur une page publique de cotation (Google Finance, Yahoo Finance, Boursorama…) : un lien par titre suivi et par couple de monnaies, un bouton de mise à jour sur l'écran concerné, et une relecture au lancement. Seule extension de l'application à émettre des requêtes vers Internet. Nécessite « Placements financiers » ou « Monnaies » : sans l'une des deux, elle n'a rien à mettre à jour.":
    "Lê uma cotação em uma página pública de cotações (Google Finance, Yahoo Finance, Boursorama…): um link por título acompanhado e por par de moedas, um botão de atualização na tela em questão e uma releitura na abertura. Única extensão do aplicativo que envia requisições à Internet. Requer « Placements financiers » ou « Monnaies »: sem uma das duas, ela não tem nada a atualizar.",
  "Suit l'argent qu'on t'a prêté : ce que tu as reçu, ce que tu rendras — intérêts compris — et ce qu'il te reste à rembourser. Les intérêts d'un prêt sont ce qu'il te coûte vraiment : ils comptent dans les sorties du mois et forment leur propre barre dans l'histogramme du dashboard. Sans cette extension, les deux onglets « Prêts reçus » et « Remboursements de prêts » de la page Opérations restent fermés et aucun prêt ne pèse sur tes totaux.":
    "Acompanha o dinheiro que lhe emprestaram: o que você recebeu, o que devolverá — juros incluídos — e o que ainda falta pagar. Os juros de um empréstimo são o que ele realmente custa a você: entram nas saídas do mês e formam sua própria barra no histograma do painel. Sem esta extensão, as duas abas « Prêts reçus » e « Remboursements de prêts » da página Transações ficam fechadas e nenhum empréstimo pesa nos seus totais.",
  "Regarde le portefeuille dans son ensemble plutôt que compte par compte : un camembert de la répartition par type de titre (ETF, obligation, action…), avec le détail des lignes qui composent chaque part. Ne calcule aucun solde et ne modifie rien — c'est une lecture. Nécessite « Placements financiers », et les types de titre se créent depuis son écran.":
    "Olha a carteira como um todo, em vez de conta por conta: um gráfico de pizza da distribuição por tipo de título (ETF, renda fixa, ação…), com o detalhe das linhas que compõem cada fatia. Não calcula nenhum saldo e não modifica nada — é uma leitura. Requer « Placements financiers », e os tipos de título são criados a partir da tela dela.",
  "Répond à « qui me doit combien, et à qui est-ce que je dois ». Sans cette extension, les deux onglets « Dépenses remboursables » et « Remboursements reçus » de la page Opérations restent fermés et aucune dépense remboursable ne pèse sur tes totaux (flux du mois, histogramme, « Reste à rembourser ») — exactement comme les prêts sans l'extension « Prêts ». Une fois activée, tu peux en plus créer des profils — une personne, une entreprise, la colocation — et y rattacher tes dépenses remboursables, tes prêts reçus et leurs règlements. L'écran donne alors, par monnaie, le solde net de chaque profil, ce qu'il te doit face à ce que tu lui dois, et le détail des lignes encore ouvertes. Un profil est une étiquette et rien de plus : le supprimer détache simplement ses opérations. L'écran s'ouvre depuis la carte « Reste à rembourser » du dashboard.":
    "Responde a « quem me deve quanto, e a quem eu devo ». Sem esta extensão, as duas abas « Dépenses remboursables » e « Remboursements reçus » da página Transações ficam fechadas e nenhuma despesa reembolsável pesa nos seus totais (fluxos do mês, histograma, « Reste à rembourser ») — exatamente como os empréstimos sem a extensão « Prêts ». Uma vez ativada, você ainda pode criar perfis — uma pessoa, uma empresa, a república — e vincular a eles suas despesas reembolsáveis, seus empréstimos recebidos e os respectivos acertos. A tela mostra então, por moeda, o saldo líquido de cada perfil, o que ele deve a você em face do que você deve a ele, e o detalhe das linhas ainda em aberto. Um perfil é um rótulo e nada mais: excluí-lo apenas desvincula suas transações. A tela abre a partir do cartão « Reste à rembourser » do painel.",
  "Objectifs":
    "Metas",
  "+ Nouvel objectif":
    "+ Nova meta",
  "Nouvel objectif":
    "Nova meta",
  "Modifier l'objectif":
    "Editar meta",
  "Supprimer l'objectif":
    "Excluir meta",
  "Objectif enregistré":
    "Meta salva",
  "Donne un nom à cet objectif.":
    "Dê um nome a esta meta.",
  "Ce qu'on mesure":
    "O que se mede",
  "Nombre de dépenses":
    "Número de despesas",
  "Montant total":
    "Valor total",
  "Montant moyen d'une dépense":
    "Valor médio de uma despesa",
  "Part des dépenses":
    "Participação nas despesas",
  "Toutes les dépenses":
    "Todas as despesas",
  "Ne pas dépasser":
    "Não ultrapassar",
  "Atteindre au moins":
    "Atingir pelo menos",
  "Cible":
    "Alvo",
  "Afficher au dashboard":
    "Mostrar no painel",
  "Semaine":
    "Semana",
  "Sur":
    "Sobre",
  "Par":
    "Por",
  "ex. Sorties restaurant":
    "ex. Restaurantes",
  "par semaine":
    "por semana",
  "par mois":
    "por mês",
  "par dépense":
    "por despesa",
  "des dépenses de la période":
    "das despesas do período",
  "dépenses sur la période":
    "despesas no período",
  "sur la période":
    "no período",
  "semaines écoulées":
    "semanas decorridas",
  "mois écoulés":
    "meses decorridos",
  "tenu":
    "cumprida",
  "manqué":
    "não cumprida",
  "cible":
    "alvo",
  "dépenses":
    "despesas",
  "Les objectifs te permettent de te fixer des cibles et les visualiser concrètement.":
    "As metas permitem que você defina alvos e os visualize concretamente.",
  "Quatre objectifs, deux manières de calculer. Montant total et part des dépenses fonctionnent comme les graphiques. Nombre de dépenses et montant moyen font abstraction des règles comme l'amortissement.":
    "Quatro metas, duas maneiras de calcular. Valor total e participação nas despesas funcionam como os gráficos. Número de despesas e valor médio ignoram regras como a diluição.",
  "Te permet de régler la plage temporelle que couvre l'objectif. -- Si tu indiques mois et que le dashboard est sur la vue mois, tu vois le total. -- Si tu indiques mois et que le dashboard est en vue année, tu verras la moyenne sur tous les mois existants.":
    "Permite definir o intervalo de tempo que a meta cobre. -- Se você indicar mês e o painel estiver na visão mês, você vê o total. -- Se você indicar mês e o painel estiver na visão ano, você verá a média de todos os meses existentes.",
  "Sur quoi porte l'objectif. -- Toutes les dépenses : tout ce qui sort, tous postes confondus. -- Une catégorie : elle classe une dépense par nature, et une dépense n'en a qu'une. -- Un projet : il regroupe par événement (un voyage, des travaux), à travers les catégories et les comptes. Une dépense peut appartenir à plusieurs projets. -- Une catégorie ou un projet, jamais les deux : les deux axes se croisent, et l'hôtel d'un voyage est à la fois dans « Loisirs » et dans « Italie ».":
    "Sobre o que a meta trata. -- Todas as despesas: tudo o que sai, todos os itens somados. -- Uma categoria: ela classifica uma despesa por natureza, e uma despesa só tem uma. -- Um projeto: ele agrupa por evento (uma viagem, uma obra), através das categorias e das contas. Uma despesa pode pertencer a vários projetos. -- Uma categoria ou um projeto, nunca os dois: os dois eixos se cruzam, e o hotel de uma viagem está ao mesmo tempo em « Loisirs » e em « Italie ».",
  "Un objectif peut n'avoir aucune cible : il se contente alors d'afficher son chiffre sous les graphes du dashboard, sans dire s'il est tenu ou manqué. -- C'est le cas ordinaire d'un projet en cours : on veut voir ce qu'il coûte bien avant de savoir ce qu'on s'autorise. -- Attention, une cible à zéro n'est pas « pas de cible » : c'est une règle, et une règle sévère (« rien du tout ce mois-ci »).":
    "Uma meta pode não ter alvo algum: ela então se limita a exibir seu número sob os gráficos do painel, sem dizer se foi cumprida ou não. -- É o caso comum de um projeto em andamento: queremos ver quanto custa bem antes de saber quanto nos permitimos. -- Atenção, um alvo igual a zero não é « sem alvo »: é uma regra, e uma regra severa (« nada mesmo este mês »).",
  "Se fixer une cible":
    "Definir um alvo",
  "Ajouter un filtre":
    "Adicionar um filtro",
  "Montant au moins":
    "Valor de pelo menos",
  "Montant au plus":
    "Valor de no máximo",
  "Libellé contenant":
    "Descrição contendo",
  "Libellé ne contenant pas":
    "Descrição não contendo",
  "Jours":
    "Dias",
  "En semaine":
    "Dias úteis",
  "Le week-end":
    "Fins de semana",
  "Ajouter un champ":
    "Adicionar um campo",
  "ex. café":
    "ex. café",
  "Chaque filtre doit avoir une valeur.":
    "Cada filtro precisa de um valor.",
  "sans":
    "sem",
  "en semaine":
    "em dias úteis",
  "le week-end":
    "nos fins de semana",
  "Semaine en cours":
    "Semana atual",
  "Moyenne du mois":
    "Média do mês",
  "cette semaine":
    "esta semana",
  "dépenses cette semaine":
    "despesas esta semana",
  "Des conditions que chaque dépense doit remplir pour être comptée : un montant minimum ou maximum, un mot présent ou absent du libellé, les jours de semaine ou le week-end. -- Toutes s'appliquent ensemble. -- Un objectif filtré compte les dépenses ligne par ligne : une dépense amortie y pèse entièrement sur le mois où elle a été faite.":
    "Condições que cada despesa deve cumprir para ser contada: um valor mínimo ou máximo, uma palavra presente ou ausente da descrição, dias úteis ou fins de semana. -- Todas se aplicam juntas. -- Uma meta filtrada conta as despesas linha por linha: uma despesa diluída pesa inteiramente no mês em que foi feita.",
  "Catégories":
    "Categorias",
  "suivi":
    "acompanhada",
  "Aucun objectif. Le bouton ci-dessus en crée un.":
    "Nenhuma meta. O botão acima cria uma.",
  "Les objectifs cochés s'affichent sous les graphes du dashboard, sur la période et la monnaie que tu y regardes. Les autres restent ici. C'est devant tes dépenses du mois qu'on se demande si on tient sa règle — mais un bloc qui grandit sans fin finirait par repousser les graphes hors de l'écran.":
    "As metas marcadas aparecem sob os gráficos do painel, no período e na moeda que você está vendo ali. As outras ficam aqui. É diante das despesas do mês que nos perguntamos se estamos cumprindo a regra — mas um bloco que cresce sem fim acabaria empurrando os gráficos para fora da tela.",
  "Ce que tu t'es fixé, mesuré sur la période affichée ci-dessus et dans la monnaie de l'onglet. Le grand chiffre est ramené à la cadence de l'objectif ; la ligne du dessous dit ce qui a servi à le calculer. Rien ici n'influe sur tes soldes ni sur tes graphes : un objectif regarde, il ne change aucun montant. Ils se créent et se modifient dans Budget → Objectifs.":
    "O que você definiu, medido no período exibido acima e na moeda da aba. O número grande é ajustado à cadência da meta; a linha de baixo diz o que serviu para calculá-lo. Nada aqui influencia seus saldos nem seus gráficos: uma meta observa, não altera nenhum valor. Elas são criadas e editadas em Orçamento → Metas.",
  "Relevé d'exemple enregistré :":
    "Extrato de exemplo salvo:",
  "Écran introuvable :":
    "Tela não encontrada:",
  "Le budget du mois est de {total} : cette catégorie ne peut pas dépasser {plafond}, sans quoi la somme des budgets par catégorie le dépasserait.":
    "O orçamento do mês é de {total}: esta categoria não pode passar de {plafond}, senão a soma dos orçamentos por categoria o ultrapassaria.",
  "La règle détecte une fois, et peut agir de plusieurs façons selon la ligne. Chaque sortie a ses propres conditions : la première qui correspond remplace les actions de la règle qu'elle renseigne, les champs laissés vides gardent celles de la règle. Aucune ne correspond : la règle agit telle quelle. Exemple : une règle « Virement interne » avec une sortie « contient LIVRET → compte en face Livret A » et une autre « contient PEA → compte en face PEA ».":
    "A regra detecta uma vez e pode agir de várias maneiras conforme a linha. Cada saída tem suas próprias condições: a primeira que corresponder substitui as ações da regra que ela preenche, os campos deixados vazios mantêm os da regra. Nenhuma corresponde: a regra age como está. Exemplo: uma regra « Transferência interna » com uma saída « contém LIVRET → conta de destino Livret A » e outra « contém PEA → conta de destino PEA ».",
  "Sorties conditionnelles":
    "Saídas condicionais",
  "+ Ajouter une sortie conditionnelle":
    "+ Adicionar uma saída condicional",
  "Aucune : la règle fait toujours la même chose.":
    "Nenhuma: a regra sempre faz a mesma coisa.",
  "Sortie":
    "Saída",
  "Combiner les groupes":
    "Combinar os grupos",
  "Supprimer la sortie":
    "Excluir a saída",
  "Si la ligne…":
    "Se a linha…",
  "…alors, à la place de la règle :":
    "…então, no lugar da regra:",
  "— celui de la règle —":
    "— o da regra —",
  "— celle de la règle —":
    "— a da regra —",
  "Chaque condition d'une sortie doit porter sur un champ et avoir une valeur.":
    "Cada condição de uma saída deve apontar para um campo e ter um valor.",
  "Une sortie conditionnelle doit changer au moins une chose.":
    "Uma saída condicional deve mudar pelo menos uma coisa.",
  "{n} sortie(s) conditionnelle(s)":
    "{n} saída(s) condicional(is)",
  "Créer une règle":
    "Criar uma regra",
  "Écrire une règle de bout en bout : ce qu'elle détecte, ce qu'elle change, ses sorties conditionnelles, et l'ordre dans lequel les règles se lisent.":
    "Escrever uma regra de ponta a ponta: o que ela detecta, o que ela altera, suas saídas condicionais e a ordem em que as regras são lidas.",
  "Les règles s'appliquent à chaque ligne importée, avant que tu ne la voies dans l'aperçu. Elles vivent ici, au-dessus des correspondances.":
    "As regras se aplicam a cada linha importada, antes de você vê-la na pré-visualização. Elas ficam aqui, acima das correspondências.",
  "Ce bouton ouvre l'éditeur d'une règle vide. On vient de l'ouvrir pour toi : rien n'est enregistré tant que tu ne cliques pas sur « Enregistrer ».":
    "Este botão abre o editor de uma regra vazia. Acabamos de abri-lo para você: nada é salvo enquanto você não clicar em “Salvar”.",
  "Un nom qui dit ce que la règle fait, et une note qui dit pourquoi elle existe — dans six mois, c'est la seule chose qui manquera.":
    "Um nome que diz o que a regra faz, e uma nota que diz por que ela existe — daqui a seis meses, é a única coisa que vai faltar.",
  "Ce que la règle doit reconnaître. Une condition porte sur un champ de la ligne (libellé, catégorie bancaire, compte, montant) ; ses mots-clés se combinent en ET. Les groupes permettent d'écrire « (A ou B) et C ». Majuscules et accents sont ignorés.":
    "O que a regra deve reconhecer. Uma condição se refere a um campo da linha (descrição, categoria do banco, conta, valor); suas palavras-chave se combinam com E. Os grupos permitem escrever “(A ou B) e C”. Maiúsculas e acentos são ignorados.",
  "Ce que la règle fait de la ligne reconnue : son type, puis sa catégorie (ou une découpe entre plusieurs). « — ne pas changer — » laisse le type aux règles suivantes.":
    "O que a regra faz com a linha reconhecida: seu tipo, depois sua categoria (ou uma divisão entre várias). “— não alterar —” deixa o tipo para as regras seguintes.",
  "Tout le reste de la ligne peut changer aussi, sauf ses montants et sa date : son nom, son compte, une note, un amortissement. Un champ vide ne change rien.":
    "Todo o resto da linha também pode mudar, exceto seus valores e sua data: seu nome, sua conta, uma nota, uma diluição. Um campo vazio não altera nada.",
  "Quand ce que la règle doit faire dépend d'un détail de la ligne, inutile de la recopier : ajoute des sorties. Chacune a ses conditions et ses actions, et la première qui correspond l'emporte. Typiquement : une seule règle « Virement interne », une sortie par compte en face.":
    "Quando o que a regra deve fazer depende de um detalhe da linha, não precisa copiá-la: adicione saídas. Cada uma tem suas condições e suas ações, e a primeira que corresponder vence. Tipicamente: uma única regra “Transferência interna”, uma saída por conta de destino.",
  "Les règles se lisent de haut en bas. Coché, ce réglage arrête la lecture quand la règle correspond ; décoché, les suivantes peuvent compléter ce qu'elle a laissé ouvert. La plus haute l'emporte toujours.":
    "As regras são lidas de cima para baixo. Marcada, esta opção interrompe a leitura quando a regra corresponde; desmarcada, as seguintes podem completar o que ela deixou em aberto. A mais alta sempre vence.",
  "L'ordre se change en glissant les règles dans la liste. La vue galerie les range par dossiers pour s'y retrouver, sans jamais changer cet ordre. Pour voir le résultat, importe un relevé : l'aperçu dit, ligne par ligne, quelle règle a agi.":
    "A ordem muda arrastando as regras na lista. A visão galeria as organiza em pastas para você se orientar, sem nunca alterar essa ordem. Para ver o resultado, importe um extrato: a pré-visualização diz, linha por linha, qual regra agiu.",
  "Les règles":
    "As regras",
  "Une nouvelle règle":
    "Uma nova regra",
  "Son nom, et pourquoi elle existe":
    "Seu nome e por que ela existe",
  "Ce qu'elle détecte":
    "O que ela detecta",
  "Ce qu'elle fait":
    "O que ela faz",
  "Et le reste de la ligne":
    "E o resto da linha",
  "Les sorties conditionnelles":
    "As saídas condicionais",
  "S'arrêter, ou laisser compléter":
    "Parar ou deixar completar",
  "L'ordre des règles":
    "A ordem das regras",
  "Deviner les colonnes":
    "Adivinhar as colunas",
  "Ne pas importer":
    "Não importar",
  "sûr":
    "certo",
  "Ce que l'application devine":
    "O que o aplicativo adivinha",
  "Lignes de tête : {n}":
    "Linhas de cabeçalho: {n}",
  "Appliquer ces colonnes":
    "Aplicar estas colunas",
  "« {propriete} » est choisie pour deux colonnes : garde-la sur une seule.":
    "“{propriete}” foi escolhida para duas colunas: mantenha-a em apenas uma.",
  "Colonnes appliquées à l'écran : relis le fichier pour voir le résultat, puis enregistre la configuration pour les garder.":
    "Colunas aplicadas na tela: releia o arquivo para ver o resultado, depois salve a configuração para mantê-las.",
  "Un CSV écrit à l'anglo-saxonne":
    "Um CSV escrito à maneira anglo-saxã",
  "Le tutoriel va afficher un fichier d'exemple à la place de celui que tu as chargé (rien n'a été importé). Continuer ?":
    "O tutorial vai mostrar um arquivo de exemplo no lugar do que você carregou (nada foi importado). Continuar?",
  "Ce fichier d'exemple est chargé dans l'écran d'import, comme si tu l'avais déposé : fais défiler « Le fichier tel qu'il est » pour voir toutes ses colonnes. Rien n'est importé.":
    "Este arquivo de exemplo está carregado na tela de importação, como se você o tivesse solto ali: role « O arquivo como ele é » para ver todas as colunas. Nada é importado.",
  "Le fichier d'exemple n'a pas été chargé : ton propre fichier est resté à l'écran.":
    "O arquivo de exemplo não foi carregado: o seu próprio arquivo continuou na tela.",
  "Tes dépenses face au budget":
    "Suas despesas diante do orçamento",
  "Période":
    "Período",
  "Comparer avec":
    "Comparar com",
  "Comparée":
    "Comparada",
  "Plein : {courante} · Hachuré : {comparee}":
    "Cheio: {courante} · Hachurado: {comparee}",
  "Aucun budget posé sur cette période : le camembert rapporte chaque catégorie au total dépensé.":
    "Nenhum orçamento definido neste período: o gráfico de pizza relaciona cada categoria ao total gasto.",
  "Tout ce qu'une règle peut changer d'autre sur la ligne, sauf ses montants et sa date. Chaque champ est facultatif : laissé vide, la règle n'en dit rien. Le nouveau nom ne change pas ce que les règles comparent — elles lisent toutes le libellé du relevé.":
    "Tudo o que uma regra pode alterar na linha, exceto seus valores e sua data. Cada campo é opcional: deixado vazio, a regra não diz nada sobre ele. O novo nome não muda o que as regras comparam — todas leem a descrição do extrato.",
  "— ne pas changer —":
    "— não alterar —",
  "Et aussi":
    "E também",
  "Renommer en":
    "Renomear para",
  "Sur le compte":
    "Na conta",
  "Avec la note":
    "Com a nota",
  "Amortir sur (mois)":
    "Diluir em (meses)",
  "Marquer comme dépense imprévue":
    "Marcar como despesa imprevista",
  "renommée « {nom} »":
    "renomeada “{nom}”",
  "sur « {compte} »":
    "em “{compte}”",
  "note « {note} »":
    "nota “{note}”",
  "amortie sur {n} mois":
    "diluída em {n} meses",
  "imprévue":
    "imprevista",
  "catégorie « {nom} »":
    "categoria “{nom}”",
  "Un amortissement s'étale sur 2 à 120 mois.":
    "Uma diluição se estende por 2 a 120 meses.",
  "Cette règle ne changerait rien : choisis au moins une action.":
    "Esta regra não alteraria nada: escolha pelo menos uma ação.",
  "on te doit 340,00 € · tu dois 0,00 €":
    "devem a você 340,00 € · você deve 0,00 €",
  "Deux points importants avant de commencer":
    "Dois pontos importantes antes de começar",
  "Où ranger tes données":
    "Onde guardar seus dados",
  "Une notice t'attend":
    "Um manual espera por você",
  "L'application explique tout ce qu'elle fait, depuis l'intérieur :":
    "O aplicativo explica tudo o que faz, por dentro:",
  "Paramètres → Paramètres généraux → Ouvrir la notice":
    "Ajustes → Ajustes gerais → Abrir o manual",
  ". On y trouve le sens de chaque chiffre du dashboard, les types d'opération, et un tutoriel guidé pour importer un premier relevé — avec un fichier d'exemple à télécharger.":
    ". Você encontra ali o sentido de cada número do painel, os tipos de transação e um tutorial guiado para importar um primeiro extrato — com um arquivo de exemplo para baixar.",
  "Notice d'utilisation":
    "Manual de uso",
  "Ouvrir la notice":
    "Abrir o manual",
  "← Retour aux paramètres":
    "← Voltar aos ajustes",
  "Pour commencer":
    "Para começar",
  "Le dashboard":
    "O painel",
  "Les types d'opération":
    "Os tipos de transação",
  "Importer un relevé":
    "Importar um extrato",
  "Les extensions":
    "As extensões",
  "Les quatre mots de l'application":
    "As quatro palavras do aplicativo",
  "Un compte":
    "Uma conta",
  "Une opération":
    "Uma transação",
  "Une catégorie":
    "Uma categoria",
  "Une monnaie":
    "Uma moeda",
  "Par où commencer":
    "Por onde começar",
  "Où vivent tes données":
    "Onde vivem seus dados",
  "La rangée du haut : ce que tu as, aujourd'hui":
    "A linha de cima: o que você tem, hoje",
  "La rangée du bas : ce que la période a fait":
    "A linha de baixo: o que o período fez",
  "Les deux graphes, et la période qu'ils regardent":
    "Os dois gráficos e o período que eles olham",
  "Dépense remboursable · Remboursement reçu":
    "Despesa reembolsável · Reembolso recebido",
  "Prêt reçu · Remboursement de prêt":
    "Empréstimo recebido · Pagamento de empréstimo",
  "Achat et vente de titres":
    "Compra e venda de títulos",
  "Trois choses qu'une opération peut porter en plus":
    "Três coisas que uma transação pode carregar além disso",
  "Un statut : réel ou prévisionnel":
    "Um status: real ou previsto",
  "Une découpe entre plusieurs catégories":
    "Uma divisão entre várias categorias",
  "Un amortissement sur plusieurs mois":
    "Uma diluição ao longo de vários meses",
  "Essayer sans risque":
    "Experimentar sem risco",
  "Télécharger le relevé d'exemple":
    "Baixar o extrato de exemplo",
  "Les cinq étapes d'un import":
    "As cinco etapas de uma importação",
  "Régler la lecture d'un fichier":
    "Configurar a leitura de um arquivo",
  "Le preset":
    "A predefinição",
  "Les colonnes lues":
    "As colunas lidas",
  "Les lignes de tête":
    "As linhas de cabeçalho",
  "Le tableau « Le fichier tel qu'il est »":
    "A tabela « O arquivo como ele é »",
  "Les réglages de lecture":
    "As configurações de leitura",
  "La configuration avancée":
    "A configuração avançada",
  "La comparaison des doublons":
    "A comparação de duplicatas",
  "Ce que l'aperçu te demande avant de confirmer":
    "O que a pré-visualização pede antes de você confirmar",
  "Les catégories bancaires à confirmer":
    "As categorias bancárias a confirmar",
  "Les doublons détectés":
    "As duplicatas detectadas",
  "Les ressemblances":
    "As semelhanças",
  "L'aperçu ligne par ligne":
    "A pré-visualização linha por linha",
  "Ce qui est allumé chez toi":
    "O que está ligado na sua máquina",
  "Éteindre n'efface jamais rien":
    "Desligar nunca apaga nada",
  "Aucune extension n'est installée : l'application fonctionne telle quelle. Les extensions se déposent dans le dossier « extensions », à côté de l'application.":
    "Nenhuma extensão está instalada: o aplicativo funciona como está. As extensões são colocadas na pasta « extensions », ao lado do aplicativo.",
  "allumée":
    "ligada",
  "non installée":
    "não instalada",
  "éteinte":
    "desligada",
  "Tutoriels guidés":
    "Tutoriais guiados",
  "Prendre l'application en main":
    "Dominar o aplicativo",
  "Le tour des quatre écrans, et les quelques idées qui ne se devinent pas : les deux rangées de cartes, la période, l'extinction plutôt que la suppression, les extensions.":
    "A volta pelas quatro telas e as poucas ideias que não se adivinham: as duas linhas de cartões, o período, desligar em vez de excluir, as extensões.",
  "Régler un preset de bout en bout, colonnes secondaires comprises — avec, à chaque colonne, l'extrait de relevé qui la rend nécessaire.":
    "Configurar uma predefinição de ponta a ponta, colunas secundárias incluídas — com, em cada coluna, o trecho de extrato que a torna necessária.",
  "Terminé":
    "Concluído",
  "Étape":
    "Etapa",
  "Pas encore commencé":
    "Ainda não começou",
  "étapes":
    "etapas",
  "Revoir":
    "Rever",
  "Reprendre":
    "Retomar",
  "Commencer":
    "Começar",
  "Recommencer":
    "Recomeçar",
  "Tutoriel terminé :":
    "Tutorial concluído:",
  "Filtres":
    "Filtros",
  "Espèces":
    "Dinheiro",
  "Total Entrées":
    "Total de entradas",
  "Total Dépenses":
    "Total de despesas",
  "Prévisionnelle":
    "Prevista",
  "Reconnaître à l'import":
    "Reconhecer na importação",
  "· {n} actif(s)":
    "· {n} ativo(s)",
  "Quitter le tutoriel":
    "Sair do tutorial",
  "Précédent":
    "Anterior",
  "Suivant":
    "Próximo",
  "Terminer":
    "Concluir",
  "L'import vit dans les Paramètres":
    "A importação vive nos Ajustes",
  "Tout se passe ici, dans l'onglet « Import ». On vient d'y aller pour toi. Garde cette bulle ouverte : elle suit les étapes pendant que tu regardes l'écran.":
    "Tudo acontece aqui, na aba « Import ». Acabamos de levar você até lá. Mantenha este balão aberto: ele acompanha as etapas enquanto você olha a tela.",
  "Un preset retient la FORME d'un fichier : quelles colonnes lire, et où. Tu en crées un par banque et par type d'export, puis tu ne le règles plus jamais. Le bouton « + Nouveau preset » en crée un ; celui qui est allumé ici est celui qu'on utilise.":
    "Uma predefinição guarda a FORMA de um arquivo: quais colunas ler e onde. Você cria uma por banco e por tipo de exportação, e nunca mais mexe nela. O botão « + Nouveau preset » cria uma; a que está acesa aqui é a que está em uso.",
  "Si le relevé ne décrit qu'un seul compte — le cas ordinaire — dis-le ici : chaque ligne importée ira sur ce compte, et le fichier n'aura pas à le nommer.":
    "Se o extrato descreve uma única conta — o caso comum — diga isso aqui: cada linha importada irá para essa conta, e o arquivo não precisará nomeá-la.",
  "Ce tableau montre ce que l'application LIT, colonne par colonne. C'est ici qu'on corrige : fais glisser un en-tête sur un autre pour échanger deux colonnes, jusqu'à ce que chaque propriété tombe en face de la bonne. Les colonnes hachurées sont celles que le réglage attend et que le fichier n'a pas.":
    "Esta tabela mostra o que o aplicativo LÊ, coluna por coluna. É aqui que se corrige: arraste um cabeçalho sobre outro para trocar duas colunas, até que cada propriedade fique diante da coluna certa. As colunas hachuradas são as que a configuração espera e que o arquivo não tem.",
  "Ce tableau apparaît dès qu'un fichier est déposé : reviens à cette étape à ce moment-là.":
    "Esta tabela aparece assim que um arquivo é solto: volte a esta etapa nesse momento.",
  "Ce bloc n'apparaît que si le fichier apporte des catégories, des comptes ou des devises inconnus.":
    "Este bloco só aparece se o arquivo trouxer categorias, contas ou moedas desconhecidas.",
  "L'aperçu apparaît une fois le fichier lu.":
    "A pré-visualização aparece depois que o arquivo é lido.",
  "C'est le seul geste qui écrit. Et s'il s'avère que le résultat ne te convient pas, l'historique des importations, plus bas, annule un import entier — les opérations qu'il a créées disparaissent, et les dépenses prévues qu'il avait remplacées reviennent telles qu'elles étaient.":
    "É o único gesto que grava. E se o resultado não lhe servir, o histórico de importações, mais abaixo, desfaz uma importação inteira — as transações que ela criou desaparecem, e as despesas previstas que ela havia substituído voltam exatamente como estavam.",
  "L'achat ou la vente d'un titre. Tu ne le saisis jamais depuis la page Opérations : il naît avec sa ligne dans l'écran des placements, et le mouvement d'espèces sur le compte-titres en découle.":
    "A compra ou a venda de um título. Você nunca a lança pela página Transações: ela nasce com sua linha na tela de investimentos, e o movimento de dinheiro na conta de títulos decorre dela.",
  "D'autres types existent et n'apparaissent qu'avec l'extension qui les ouvre : dépenses remboursables, prêts reçus, opérations sur titres. Va voir Paramètres → Extensions pour savoir ce que tu as sous la main.":
    "Existem outros tipos, que só aparecem com a extensão que os abre: despesas reembolsáveis, empréstimos recebidos, transações com títulos. Veja Ajustes → Extensões para saber o que você tem à mão.",
  "Corrige la lecture si besoin : glisse les en-têtes pour remettre chaque propriété en face de la bonne colonne, dis combien de lignes de tête sauter, puis enregistre la configuration dans le preset.":
    "Corrija a leitura se precisar: arraste os cabeçalhos para colocar cada propriedade diante da coluna certa, diga quantas linhas de cabeçalho pular, depois salve a configuração na predefinição.",
  "Monnaie désactivée":
    "Moeda desligada",
  "Monnaie réactivée":
    "Moeda religada",
  "Sans enveloppe":
    "Sem veículo",
  "Comment c'est détenu":
    "Como é mantido",
  "À quoi c'est exposé":
    "A que está exposto",
  "Enveloppes":
    "Veículos",
  "Classes d'actif":
    "Classes de ativo",
  "Classe d'actif":
    "Classe de ativo",
  "Enveloppe":
    "Veículo",
  "Ajouter l'enveloppe":
    "Adicionar o veículo",
  "Ajouter la classe":
    "Adicionar a classe",
  "ex. Matières premières":
    "ex. Commodities",
  "Étiquette ajoutée":
    "Rótulo adicionado",
  "Aucune enveloppe. Ajoutes-en une ci-dessous si tu veux regrouper tes titres.":
    "Nenhum veículo. Adicione um abaixo se quiser agrupar seus títulos.",
  "Aucune classe d'actif. Ajoutes-en une ci-dessous pour voir à quoi ton portefeuille expose.":
    "Nenhuma classe de ativo. Adicione uma abaixo para ver a que sua carteira está exposta.",
  "Enveloppe : comment le titre est détenu — purement descriptif":
    "Veículo: como o título é mantido — puramente descritivo",
  "Classe d'actif : à quoi le titre expose — purement descriptif":
    "Classe de ativo: a que o título expõe — puramente descritivo",
  "Sans classe":
    "Sem classe",
  "Obligations":
    "Renda fixa",
  "Immobilier":
    "Imóveis",
  "Matières premières":
    "Commodities",
  "Monétaire":
    "Monetário",
  "&larr; Retour au tableau de bord":
    "&larr; Voltar ao painel",
  "&larr; Retour aux projets":
    "&larr; Voltar aos projetos",
  "Ouvrir":
    "Abrir",
  "Chercher":
    "Buscar",
  "Voir la note":
    "Ver a nota",
  "Voir le portefeuille":
    "Ver a carteira",
  "Description":
    "Descrição",
  "Actualisation":
    "Atualização",
  "Groupe":
    "Grupo",
  "Projets":
    "Projetos",
  "Prêts":
    "Empréstimos",
  "Lecture de cours":
    "Leitura de cotações",
  "{n} opération(s)":
    "{n} transação(ões)",
  "Type renommé":
    "Tipo renomeado",
  "Type supprimé":
    "Tipo excluído",
  "Nouveau nom pour « {nom} »":
    "Novo nome para « {nom} »",
  "Supprimer « {nom} » ?":
    "Excluir « {nom} »?",
  "aucun titre":
    "nenhum título",
  "titre typé":
    "título classificado",
  "— aucun type de titre créé —":
    "— nenhum tipo de título criado —",
  "ex. ETF":
    "ex. ETF",
  "ex. 0":
    "ex. 0",
  "Emplacement du fichier":
    "Local do arquivo",
  "Ranger mes données ici":
    "Guardar meus dados aqui",
  "Créer / déplacer ici":
    "Criar / mover para cá",
  "dans le dossier de l'application":
    "na pasta do aplicativo",
  "— l'endroit qu'une mise à jour":
    "— o lugar que uma atualização",
  "Glisser vers une autre colonne pour reclasser":
    "Arraste para outra coluna para reclassificar",
  "obligatoires et ne s'éteignent pas.":
    "obrigatórias e não podem ser desligadas.",
  "depuis l'opération d'origine.":
    "a partir da transação de origem.",
  "preset.":
    "predefinição.",
  "Et type le titre en":
    "E classifica o título como",
  "du courtier":
    "da corretora",
  "achat":
    "compra",
  "avec":
    "com",
  "entier":
    "inteira",
  "le type \"Placements financiers\", puis reviens ici.":
    "o tipo \"Placements financiers\", depois volte aqui.",
  "d'évaluation":
    "de avaliação",
  "Afficher les pages reconnues":
    "Mostrar as páginas reconhecidas",
  "Quelles pages puis-je coller ?":
    "Quais páginas posso colar?",
  "Non installées sur cette machine":
    "Não instaladas nesta máquina",
  "Catégories ▾":
    "Categorias ▾",
  "Colonnes":
    "Colunas",
  "Les comptes d'ÉPARGNE seulement, et leur solde réel. Un compte de placements porte des titres, qui ne sont disponibles qu'après une vente, à un cours qu'on ne connaît pas d'avance : les compter dans un matelas de sécurité reviendrait à se rassurer avec de l'argent qu'on n'a pas encore. Laisse à zéro pour ne pas poser de seuil du tout.":
    "Apenas as contas POUPANÇA, e seu saldo real. Uma conta de investimentos carrega títulos, que só ficam disponíveis depois de uma venda, a uma cotação que não se conhece de antemão: contá-los em uma reserva de segurança seria se tranquilizar com dinheiro que ainda não se tem. Deixe em zero para não definir limite algum.",
  "Ce que tu as mis de côté":
    "O que você guardou",
  "Matelas de sécurité":
    "Reserva de segurança",
  "Dépenses imprévues":
    "Despesas imprevistas",
  "Dépense imprévue":
    "Despesa imprevista",
  "Montant minimum à garder disponible":
    "Valor mínimo a manter disponível",
  "Les lignes de l'année":
    "Os lançamentos do ano",
  "Mois par mois":
    "Mês a mês",
  "mis de côté en {annee}":
    "guardado em {annee}",
  "d'imprévu en {annee}":
    "de imprevistos em {annee}",
  "Versé {verse} · Repris {retire}":
    "Depositado {verse} · Retirado {retire}",
  "{part} de {total} dépensés":
    "{part} de {total} gastos",
  "Aucun matelas posé pour cette monnaie.":
    "Nenhuma reserva definida para esta moeda.",
  "Il manque {montant}":
    "Faltam {montant}",
  "Marge de {montant}":
    "Folga de {montant}",
  "{dispo} disponible sur {seuil} voulus":
    "{dispo} disponível de {seuil} desejados",
  "Matelas enregistré.":
    "Reserva salva.",
  "Matelas de sécurité franchi : il manque {montant}.":
    "Reserva de segurança ultrapassada: faltam {montant}.",
  "Aucune dépense marquée imprévue cette année.":
    "Nenhuma despesa marcada como imprevista este ano.",
  "Dépenses prévues reconnues":
    "Despesas previstas reconhecidas",
  "{n} opération(s) importée(s), dont {p} qui remplacent une dépense prévue.":
    "{n} transação(ões) importada(s), das quais {p} substituem uma despesa prevista.",
  "Import annulé : {n} opération(s) supprimée(s), {p} dépense(s) prévue(s) rendue(s).":
    "Importação cancelada: {n} transação(ões) excluída(s), {p} despesa(s) prevista(s) restaurada(s).",
  "Remplacer":
    "Substituir",
  "Ligne du relevé":
    "Linha do extrato",
  "Remplacera la dépense prévue":
    "Substituirá a despesa prevista",
  "prévue entre le {debut} et le {fin}":
    "prevista entre {debut} e {fin}",
  "prévue le {date}":
    "prevista para {date}",
  "occurrence d'une opération récurrente":
    "ocorrência de uma transação recorrente",
  "Attendue à partir du":
    "Esperada a partir de",
  "Jusqu'au":
    "Até",
  "Mots-clés du libellé":
    "Palavras-chave da descrição",
  "Tout convertir":
    "Converter tudo",
  "Tout convertir en {monnaie}":
    "Converter tudo em {monnaie}",
  "Ce budget additionne les douze mois de l'année ET les monnaies converties :":
    "Este orçamento soma os doze meses do ano E as moedas convertidas:",
  "Ce budget additionne les monnaies converties :":
    "Este orçamento soma as moedas convertidas:",
  "Pas de taux pour {monnaies} : ces montants ne sont pas comptés. Saisis leur taux dans Paramètres → Monnaies.":
    "Sem taxa para {monnaies}: esses valores não são contados. Informe a taxa deles em Ajustes → Moedas.",
  "Aucune catégorie sélectionnée.":
    "Nenhuma categoria selecionada.",
  "Catégorie modifiée":
    "Categoria modificada",
  "Compte courant":
    "Conta corrente",
  "Compte d'épargne":
    "Conta poupança",
  "Compte de placements":
    "Conta de investimentos",
  "Intérêts perçus":
    "Juros recebidos",
  "Montant perçu":
    "Valor recebido",
  "Total perçu":
    "Total recebido",
  "Aucun versement saisi pour ce compte.":
    "Nenhum pagamento registrado para esta conta.",
  "Supprimer ce versement d'intérêts ?":
    "Excluir este pagamento de juros?",
  "Une date et un montant supérieur à zéro sont nécessaires.":
    "É necessária uma data e um valor maior que zero.",
  "Versement ajouté.":
    "Pagamento adicionado.",
  "Versement modifié.":
    "Pagamento modificado.",
  "Versement supprimé.":
    "Pagamento excluído.",
  "Versement":
    "Depósito",
  "Aucun compte d'épargne. Crée-en un depuis Paramètres → Comptes en choisissant le type":
    "Nenhuma conta poupança. Crie uma em Ajustes → Contas escolhendo o tipo",
  "« épargne », puis reviens ici.":
    "« poupança », depois volte aqui.",
  "suivi d'affichage":
    "acompanhamento de exibição",
  "Amorti":
    "Diluído",
  "Amortie":
    "Diluída",
  "Récurrent":
    "Recorrente",
  "Peu importe":
    "Tanto faz",
  "Oui":
    "Sim",
  "Non":
    "Não",
  "Comporte des frais ?":
    "Tem tarifas?",
  "Lié à une opération remboursable ?":
    "Vinculada a uma transação reembolsável?",
  "Lié à un prêt reçu ?":
    "Vinculado a um empréstimo recebido?",
  "Montant à rembourser min":
    "Valor a reembolsar mín.",
  "Montant à rembourser max":
    "Valor a reembolsar máx.",
  "Reste à rembourser min":
    "Resta a reembolsar mín.",
  "Reste à rembourser max":
    "Resta a reembolsar máx.",
  "Montant envoyé min":
    "Valor enviado mín.",
  "Montant envoyé max":
    "Valor enviado máx.",
  "Montant reçu min":
    "Valor recebido mín.",
  "Montant reçu max":
    "Valor recebido máx.",
  "contient…":
    "contém…",
  "Opération classique":
    "Transação padrão",
  "Virement interne":
    "Transferência interna",
  "Remboursement reçu":
    "Reembolso recebido",
  "Remboursement de prêt":
    "Pagamento de empréstimo",
  "Vue d'ensemble des placements":
    "Visão geral dos investimentos",
  "Vue d'ensemble":
    "Visão geral",
  "Retour aux placements":
    "Voltar aos investimentos",
  "&larr; Retour aux placements":
    "&larr; Voltar aos investimentos",
  "Répartition par type de titre":
    "Distribuição por tipo de título",
  "Valeur du portefeuille":
    "Valor da carteira",
  "{n} comptes":
    "{n} contas",
  "{n} titre(s)":
    "{n} título(s)",
  "et {n} autre(s)":
    "e mais {n}",
  "Aucun titre détenu pour le moment. Achète ou importe des titres depuis la page":
    "Nenhum título em carteira por enquanto. Compre ou importe títulos na página",
  "Placements financiers, et la répartition apparaîtra ici.":
    "Investimentos, e a distribuição aparecerá aqui.",
  "Enregistrer le taux":
    "Salvar a taxa",
  "1 unité de":
    "1 unidade de",
  "vaut, en":
    "vale, em",
  "ce nombre d'unités":
    "este número de unidades",
  "ex. 1,08":
    "ex. 1,08",
  "Aucun taux enregistré.":
    "Nenhuma taxa salva.",
  "Taux supprimé":
    "Taxa excluída",
  "relu en ligne":
    "lida online",
  "saisi à la main":
    "informada à mão",
  "Le taux doit être un nombre strictement positif.":
    "A taxa deve ser um número estritamente positivo.",
  "Choisis deux monnaies différentes.":
    "Escolha duas moedas diferentes.",
  "Ajoute une seconde monnaie pour pouvoir saisir un taux.":
    "Adicione uma segunda moeda para poder informar uma taxa.",
  "Aucun taux relu en ligne : choisis « Depuis un lien » pour en suivre un.":
    "Nenhuma taxa lida online: escolha « A partir de um link » para acompanhar uma.",
  "D'où vient l'écart ?":
    "De onde vem a diferença?",
  "← Retour au dashboard":
    "← Voltar ao painel",
  "Les opérations qui l'expliquent":
    "As transações que a explicam",
  "Écart":
    "Diferença",
  "Au compte":
    "Na conta",
  "Au mois":
    "No período",
  "Pourquoi":
    "Por quê",
  "Libellé":
    "Descrição",
  "Dépense étalée":
    "Despesa diluída",
  "Dépense remboursable":
    "Despesa reembolsável",
  "Prêt reçu":
    "Empréstimo recebido",
  "Les deux variations ne répondent pas à la même question, elles n'ont donc jamais le même chiffre. Voici, opération par opération, ce qui les sépare sur la période affichée.":
    "As duas variações não respondem à mesma pergunta, por isso nunca mostram o mesmo número. Eis, transação por transação, o que as separa no período exibido.",
  "La variation brute moins la variation attribuée. C'est exactement la somme de la colonne « Écart » ci-dessous : tout ce qui a bougé le compte sans appartenir à cette période, ou l'inverse.":
    "A variação bruta menos a variação atribuída. É exatamente a soma da coluna « Diferença » abaixo: tudo o que moveu a conta sem pertencer a este período, ou o inverso.",
  "Chaque ligne montre ce que l'opération apporte aux DEUX calculs. « Au compte » : ce qui est passé, à sa date et pour son montant. « Au mois » : ce que la période en porte réellement. Une opération qui compte pareil des deux côtés n'apparaît pas — elle n'explique rien.":
    "Cada linha mostra o que a transação traz para os DOIS cálculos. « Na conta »: o que passou, na data dela e pelo valor dela. « No período »: o que o período realmente carrega. Uma transação que conta igual dos dois lados não aparece — ela não explica nada.",
  "Aucun écart sur cette période : les deux variations disent la même chose.":
    "Nenhuma diferença neste período: as duas variações dizem a mesma coisa.",
  "Objectif":
    "Alvo",
  "Total des avoirs":
    "Total dos ativos",
  "Répartition des avoirs":
    "Distribuição dos ativos",
  "Aucun solde positif à répartir.":
    "Nenhum saldo positivo a distribuir.",
  "Répartition des avoirs par type de compte":
    "Distribuição dos ativos por tipo de conta",
  "Comptes courants":
    "Contas correntes",
  "Comptes d'épargne":
    "Contas poupança",
  "Comptes de placements":
    "Contas de investimentos",
  "Vue globale des comptes":
    "Visão global das contas",
  "Vue des avoirs":
    "Visão dos ativos",
  "Dépenses par catégorie —":
    "Despesas por categoria —",
  "Notes":
    "Notas",
  "Un pense-bête, non lu par l'app. Ça s'enregistre tout seul.":
    "Um lembrete, nunca lido pelo app. Salva sozinho.",
  "ex. vérifier que le prélèvement EDF de mars est bien passé relancer Marie pour les 40 € du restaurant":
    "ex. verificar se o débito da conta de luz de março passou, cobrar a Marie pelos 40 € do restaurante",
  "Supprimer toutes les opérations":
    "Excluir todas as transações",
  "Opérations classiques":
    "Transações padrão",
  "Dépenses remboursables":
    "Despesas reembolsáveis",
  "Remboursements reçus":
    "Reembolsos recebidos",
  "Virements internes":
    "Transferências internas",
  "Prêts reçus":
    "Empréstimos recebidos",
  "Remboursements de prêts":
    "Pagamentos de empréstimos",
  "Trier par":
    "Ordenar por",
  "+ Ajouter une opération":
    "+ Adicionar uma transação",
  "Ponctuelles":
    "Pontuais",
  "Récurrentes":
    "Recorrentes",
  "Compte":
    "Conta",
  "Tous":
    "Todos",
  "Catégorie":
    "Categoria",
  "Toutes":
    "Todas",
  "Statut":
    "Status",
  "Du":
    "De",
  "Au":
    "Até",
  "Filtrer":
    "Filtrar",
  "Réinitialiser":
    "Redefinir",
  "Ajouter une opération":
    "Adicionar uma transação",
  "Nature":
    "Descrição",
  "Montant":
    "Valor",
  "Monnaie":
    "Moeda",
  "Montant reçu":
    "Valor recebido",
  "Monnaie reçue":
    "Moeda recebida",
  "Date":
    "Data",
  "Compte source":
    "Conta de origem",
  "Compte destination":
    "Conta de destino",
  "Récurrente":
    "Recorrente",
  "Générée automatiquement par une opération récurrente : modifie ou arrête la récurrence depuis l'opération d'origine.":
    "Gerada automaticamente por uma transação recorrente: edite ou interrompa a recorrência a partir da transação de origem.",
  "Fréquence":
    "Frequência",
  "Hebdomadaire":
    "Semanal",
  "Mensuelle":
    "Mensal",
  "Trimestrielle":
    "Trimestral",
  "Annuelle":
    "Anual",
  "Sans date de fin":
    "Sem data de término",
  "Date de fin":
    "Data de término",
  "Colonnes lues":
    "Colunas lidas",
  "Lignes de tête à ne pas importer":
    "Linhas de cabeçalho a não importar",
  "{n} colonne(s) lue(s)":
    "{n} coluna(s) lida(s)",
  "doublons : toutes les colonnes":
    "duplicatas: todas as colunas",
  "doublons : toutes sauf {n}":
    "duplicatas: todas menos {n}",
  "doublons : {n} colonne(s) comparée(s)":
    "duplicatas: {n} coluna(s) comparada(s)",
  "Colonnes secondaires":
    "Colunas secundárias",
  "Lignes à ne pas importer":
    "Linhas a não importar",
  "Réglages de lecture (délimiteur, séparateur décimal)":
    "Configurações de leitura (delimitador, separador decimal)",
  "aucune ligne ignorée":
    "nenhuma linha ignorada",
  "{n} ligne(s) ignorée(s)":
    "{n} linha(s) ignorada(s)",
  "Aucune colonne désignée.":
    "Nenhuma coluna designada.",
  "Seules ces colonnes distinguent deux lignes.":
    "Só estas colunas distinguem duas linhas.",
  "Toutes les colonnes sont comparées, sauf celles-ci.":
    "Todas as colunas são comparadas, exceto estas.",
  "Ajouter cette colonne":
    "Adicionar esta coluna",
  "Amortie sur plusieurs mois":
    "Diluída ao longo de vários meses",
  "Découper entre plusieurs catégories":
    "Dividir entre várias categorias",
  "égal à":
    "igual a",
  "différent de":
    "diferente de",
  "supérieur à":
    "maior que",
  "supérieur ou égal à":
    "maior ou igual a",
  "inférieur à":
    "menor que",
  "inférieur ou égal à":
    "menor ou igual a",
  "découpée":
    "dividida",
  "La découpe ci-dessous tient lieu de catégorie.":
    "A divisão abaixo faz as vezes de categoria.",
  "Une seule part peut valoir « reste ».":
    "Apenas uma parte pode valer « reste ».",
  "La règle répartit le montant de la ligne entre plusieurs catégories, au lieu d'en poser une seule. Réservé aux opérations classiques.":
    "A regra reparte o valor da linha entre várias categorias, em vez de definir uma só. Reservado às transações padrão.",
  "+ Ajouter une part":
    "+ Adicionar uma parte",
  "Ajouter une part":
    "Adicionar uma parte",
  "Retirer cette part":
    "Remover esta parte",
  "Réparti":
    "Distribuído",
  "reste à placer":
    "resta distribuir",
  "Une découpe compte au moins deux parts remplies.":
    "Uma divisão tem pelo menos duas partes preenchidas.",
  "Une même catégorie ne peut pas apparaître deux fois dans la découpe.":
    "A mesma categoria não pode aparecer duas vezes na divisão.",
  "Le total des parts doit valoir le montant de l'opération.":
    "O total das partes deve ser igual ao valor da transação.",
  "Découpée":
    "Dividida",
  "parts":
    "partes",
  "Voir le détail de la découpe":
    "Ver o detalhe da divisão",
  "Premier mois":
    "Primeiro mês",
  "Dernier mois":
    "Último mês",
  "Nombre de mois":
    "Número de meses",
  "Mois":
    "Mês",
  "Année":
    "Ano",
  "ex. facture partagée avec Léa":
    "ex. conta dividida com a Léa",
  "Renseigne deux des trois cases d'amortissement (premier mois, dernier mois, nombre de mois).":
    "Preencha dois dos três campos de diluição (primeiro mês, último mês, número de meses).",
  "Montant à rembourser":
    "Valor a reembolsar",
  "Reste à rembourser":
    "Resta a reembolsar",
  "Opérations remboursées":
    "Transações reembolsadas",
  "Un commentaire non lu par l'app. Sur un virement, il vaut pour les deux comptes.":
    "Um comentário que o app não lê. Em uma transferência, vale para as duas contas.",
  "ex. facture partagée avec Léa, à revérifier sur le relevé de mars":
    "ex. conta dividida com a Léa, a conferir no extrato de março",
  "Enregistrer":
    "Salvar",
  "Annuler":
    "Cancelar",
  "Aucun compte de placements financiers. Crée-en un depuis la page Comptes en choisissant le type \"Placements financiers\", puis alimente-le par un virement interne.":
    "Nenhuma conta de investimentos. Crie uma na página Contas escolhendo o tipo \"Placements financiers\", depois alimente-a com uma transferência interna.",
  "Titres détenus":
    "Títulos em carteira",
  "Titre":
    "Título",
  "Quantité":
    "Quantidade",
  "Prix de revient":
    "Preço médio",
  "Investi":
    "Investido",
  "Cours":
    "Cotação",
  "Valorisation":
    "Valorização",
  "+/- value":
    "Ganho / perda",
  "Acheter / vendre":
    "Comprar / vender",
  "Achat":
    "Compra",
  "Vente":
    "Venda",
  "Prix unitaire":
    "Preço unitário",
  "Mouvements sur titres":
    "Movimentos de títulos",
  "Sens":
    "Sentido",
  "Actions":
    "Ações",
  "Titres suivis":
    "Títulos acompanhados",
  "Nom du titre":
    "Nome do título",
  "ex. Air Liquide":
    "ex. Air Liquide",
  "Monnaie de cotation":
    "Moeda de cotação",
  "Cours actuel":
    "Cotação atual",
  "Ajouter le titre":
    "Adicionar o título",
  "Afficher les titres archivés":
    "Mostrar os títulos arquivados",
  "Archiver":
    "Arquivar",
  "Remettre en service":
    "Reativar",
  "archivé":
    "arquivado",
  "Ranger ce titre : il quitte les listes, son historique reste":
    "Guardar este título: ele sai das listas, o histórico permanece",
  "Remettre ce titre dans les listes":
    "Colocar este título de volta nas listas",
  "Titre archivé. Ses mouvements et ses plus-values sont intacts.":
    "Título arquivado. Seus movimentos e seus ganhos continuam intactos.",
  "Titre remis en service.":
    "Título reativado.",
  "Mettre à jour les cours":
    "Atualizar as cotações",
  "Pages reconnues":
    "Páginas reconhecidas",
  "mis à jour {quand}":
    "atualizado {quand}",
  "Lien de la page de cotation":
    "Link da página de cotação",
  "Taux de change":
    "Taxas de câmbio",
  "Mettre à jour les taux":
    "Atualizar as taxas",
  "la page":
    "a página",
  "Ne plus suivre":
    "Deixar de acompanhar",
  "{n} couple(s) suivi(s)":
    "{n} par(es) acompanhado(s)",
  "jamais mis à jour":
    "nunca atualizado",
  "{n} taux mis à jour":
    "{n} taxa(s) atualizada(s)",
  "Colle le lien de la page de cotation.":
    "Cole o link da página de cotação.",
  "Taux lu sur {source} : {libelle} = {taux}":
    "Taxa lida em {source}: {libelle} = {taux}",
  "Couple enregistré":
    "Par salvo",
  "Lecture en cours…":
    "Leitura em andamento…",
  "Mettre à jour":
    "Atualizar",
  "Détacher":
    "Desvincular",
  "Relire le cours maintenant":
    "Reler a cotação agora",
  "Ne plus suivre ce cours en ligne":
    "Deixar de acompanhar esta cotação online",
  "Lien de la page de cotation (Google Finance, Yahoo Finance…)":
    "Link da página de cotação (Google Finance, Yahoo Finance…)",
  "cours saisi à la main":
    "cotação informada à mão",
  "à l'instant":
    "agora mesmo",
  "il y a {n} min":
    "há {n} min",
  "il y a {n} h":
    "há {n} h",
  "jamais lus":
    "nunca lidos",
  "dernière lecture {quand}":
    "última leitura {quand}",
  "{n} titre(s) suivi(s) en ligne":
    "{n} título(s) acompanhado(s) online",
  "{n} en échec":
    "{n} com falha",
  "{n} cours mis à jour":
    "{n} cotação(ões) atualizada(s)",
  "Aucun titre n'a de lien à relire":
    "Nenhum título tem link para reler",
  "Aucun titre n'a de lien : ajoute-en un dans « Titres suivis », en bas de page.":
    "Nenhum título tem link: adicione um em « Títulos acompanhados », no pé da página.",
  "Cours lu sur {source} : {nom} — {cours}":
    "Cotação lida em {source}: {nom} — {cours}",
  "Lien enregistré":
    "Link salvo",
  "Lien retiré — le cours redevient saisi à la main":
    "Link removido — a cotação volta a ser informada à mão",
  "{n} cours n'ont pas pu être relus au lancement (voir Placements)":
    "{n} cotações não puderam ser relidas na abertura (veja Investimentos)",
  "Tes titres, communs à tous tes comptes. Colle le lien d'une page de cotation à côté d'un titre et son cours se relira tout seul : c'est la seule chose que l'app va chercher sur Internet, et seulement pour les titres qui ont un lien. Le cours dit ce que ça vaut aujourd'hui, jamais comment un solde est calculé.":
    "Seus títulos, comuns a todas as suas contas. Cole o link de uma página de cotação ao lado de um título e a cotação dele será relida sozinha: é a única coisa que o app busca na Internet, e só para os títulos que têm um link. A cotação diz quanto vale hoje, nunca como um saldo é calculado.",
  "Monnaies":
    "Moedas",
  "Règles":
    "Regras",
  "Import":
    "Importação",
  "Base de données":
    "Banco de dados",
  "Extensions détectées":
    "Extensões detectadas",
  "Une extension a été trouvée dans le dossier « extensions ». Elle ne fonctionnera qu'une fois activée ci-dessous — fermer cette fenêtre ne l'active pas.":
    "Uma extensão foi encontrada na pasta « extensions ». Ela só funcionará depois de ativada abaixo — fechar esta janela não a ativa.",
  "{n} extensions ont été trouvées dans le dossier « extensions ». Elles ne fonctionneront qu'une fois activées ci-dessous — fermer cette fenêtre n'en active aucune.":
    "{n} extensões foram encontradas na pasta « extensions ». Elas só funcionarão depois de ativadas abaixo — fechar esta janela não ativa nenhuma.",
  "Fermer":
    "Fechar",
  "Aller au menu extensions":
    "Ir ao menu de extensões",
  "Extensions":
    "Extensões",
  "Nécessite au moins une de ces extensions, installée et activée :":
    "Requer pelo menos uma destas extensões, instalada e ativada:",
  "Une extension ajoute une fonctionnalité. La désactiver fait disparaître son écran sans rien effacer — tout revient si tu la rallumes.":
    "Uma extensão adiciona um recurso. Desativá-la faz sua tela desaparecer sem apagar nada — tudo volta se você a religar.",
  "Aucune extension installée.":
    "Nenhuma extensão instalada.",
  "Activée":
    "Ativada",
  "Désactivée":
    "Desativada",
  "État de l'extension":
    "Estado da extensão",
  "Afficher ce que fait cette extension":
    "Mostrar o que esta extensão faz",
  "Afficher l'avertissement":
    "Mostrar o aviso",
  "Afficher l'explication":
    "Mostrar a explicação",
  "Ajouter une monnaie":
    "Adicionar uma moeda",
  "développeur":
    "desenvolvedor",
  "Extension activée.":
    "Extensão ativada.",
  "Extension désactivée. Aucune donnée n'a été supprimée.":
    "Extensão desativada. Nenhum dado foi excluído.",
  "Extension non chargée":
    "Extensão não carregada",
  "Double-clique une ligne pour modifier un compte, fais-la glisser d'une carte à l'autre pour changer son type.":
    "Clique duas vezes em uma linha para editar uma conta, arraste-a de um cartão para outro para mudar o tipo dela.",
  "Ajouter un compte":
    "Adicionar uma conta",
  "Nom":
    "Nome",
  "Type":
    "Tipo",
  "Monnaies du compte":
    "Moedas da conta",
  "Ajouter":
    "Adicionar",
  "Catégories de dépenses":
    "Categorias de despesas",
  "Ordre":
    "Ordem",
  "Budget":
    "Orçamento",
  "Ajouter une catégorie":
    "Adicionar uma categoria",
  "Montant du budget":
    "Valor do orçamento",
  "Total réparti":
    "Total distribuído",
  "Aucune catégorie.":
    "Nenhuma categoria.",
  "ex. Dollar américain":
    "ex. Dólar americano",
  "Symbole":
    "Símbolo",
  "ex. $":
    "ex. $",
  "Chemin complet du fichier .db":
    "Caminho completo do arquivo .db",
  "C:\\chemin\\vers\\ma_base.db":
    "C:\\caminho\\para\\meu_banco.db",
  "Parcourir…":
    "Procurar…",
  "Basculer sur ce fichier":
    "Trocar para este arquivo",
  "avant":
    "antes",
  "Vue liste":
    "Visão em lista",
  "Vue galerie":
    "Visão em galeria",
  "+ Nouveau dossier":
    "+ Nova pasta",
  "Glisse une règle ici.":
    "Arraste uma regra para cá.",
  "Rang d'évaluation":
    "Posição de avaliação",
  "inactive":
    "inativa",
  "Nom du nouveau dossier":
    "Nome da nova pasta",
  "Nouveau nom du dossier":
    "Novo nome da pasta",
  "Un dossier porte déjà ce nom.":
    "Já existe uma pasta com este nome.",
  "Supprimer le dossier":
    "Excluir a pasta",
  "Ses règles reviendront dans « Autres ».":
    "Suas regras voltarão para « Outras ».",
  "↳ la lecture continue avec les règles suivantes":
    "↳ a leitura continua com as regras seguintes",
  "Règles de catégorisation":
    "Regras de categorização",
  "+ Nouvelle règle":
    "+ Nova regra",
  "Nouvelle règle":
    "Nova regra",
  "Nom de la règle":
    "Nome da regra",
  "ex. Prêts reçus":
    "ex. Empréstimos recebidos",
  "Conditions":
    "Condições",
  "Les groupes se combinent entre eux ; à l'intérieur d'un groupe, les conditions se combinent selon leur propre connecteur. Deux niveaux suffisent à écrire « (A ou B) et C ».":
    "Os grupos se combinam entre si; dentro de um grupo, as condições se combinam conforme o próprio conector. Dois níveis bastam para escrever « (A ou B) e C ».",
  "Combiner les groupes avec":
    "Combinar os grupos com",
  "ET (tous les groupes)":
    "E (todos os grupos)",
  "OU (au moins un groupe)":
    "OU (pelo menos um grupo)",
  "+ Ajouter un groupe":
    "+ Adicionar um grupo",
  "Action":
    "Ação",
  "Classer comme":
    "Classificar como",
  "Dans la catégorie":
    "Na categoria",
  "Avec le compte en face":
    "Com a conta de destino",
  "L'autre compte du virement, celui que le relevé ne nomme pas. Le sens se déduit du signe du montant. Sans lui, la ligne est à compléter à la main dans l'aperçu.":
    "A outra conta da transferência, a que o extrato não nomeia. O sentido é deduzido do sinal do valor. Sem ela, a linha precisa ser completada à mão na pré-visualização.",
  "— à renseigner à l'import —":
    "— a informar na importação —",
  "Règle active":
    "Regra ativa",
  "Arrêter la lecture des règles ici":
    "Parar a leitura das regras aqui",
  "Coché, le réglage habituel : cette règle décide, on s'arrête là. Décoché, les règles suivantes peuvent compléter ce qu'elle laisse ouvert — la catégorie, le compte en face. Le type reste celui de la première règle qui a mordu.":
    "Marcada, a configuração habitual: esta regra decide e paramos por aí. Desmarcada, as regras seguintes podem completar o que ela deixa em aberto — a categoria, a conta de destino. O tipo continua sendo o da primeira regra que pegou.",
  "Correspondances":
    "Correspondências",
  "Correspondances mémorisées":
    "Correspondências memorizadas",
  "Catégories bancaires":
    "Categorias bancárias",
  "Comptes bancaires":
    "Contas bancárias",
  "Devises":
    "Moedas",
  "Alimentaire":
    "Alimentação",
  "Loisirs":
    "Lazer",
  "Transports":
    "Transporte",
  "Charges fixes":
    "Custos fixos",
  "Entrées d'argent":
    "Receitas",
  "Autres":
    "Outras",
  "plus rien à annuler":
    "nada mais a cancelar",
  "import trop ancien":
    "importação antiga demais",
  "Cet import est antérieur au suivi des opérations importées : l'app ne sait pas lesquelles il a créées, elle ne peut donc pas les retirer. Seuls les imports faits depuis sont annulables.":
    "Esta importação é anterior ao acompanhamento das transações importadas: o app não sabe quais ela criou, portanto não pode removê-las. Só as importações feitas desde então podem ser canceladas.",
  "Aucun import pour le moment.":
    "Nenhuma importação por enquanto.",
  "Annuler cet import supprimera {n} opération(s) et le rendra réimportable. Cette action est irréversible. Continuer ?":
    "Cancelar esta importação excluirá {n} transação(ões) e a tornará importável de novo. Esta ação é irreversível. Continuar?",
  "Import annulé : {n} opération(s) supprimée(s).":
    "Importação cancelada: {n} transação(ões) excluída(s).",
  "À régler seulement si le fichier est mal lu : colonnes mélangées, montants illisibles. L'app devine seule dans la plupart des cas.":
    "Só vale a pena configurar se o arquivo for lido errado: colunas misturadas, valores ilegíveis. O app descobre sozinho na maioria dos casos.",
  "Délimiteur de colonnes":
    "Delimitador de colunas",
  "Détecter automatiquement":
    "Detectar automaticamente",
  "Point-virgule ( ; )":
    "Ponto e vírgula ( ; )",
  "Virgule ( , )":
    "Vírgula ( , )",
  "Tabulation":
    "Tabulação",
  "Autre…":
    "Outro…",
  "ex. |":
    "ex. |",
  "Séparateur décimal":
    "Separador decimal",
  "Détecter automatiquement (virgule française)":
    "Detectar automaticamente (vírgula francesa)",
  "Virgule — 1234,56":
    "Vírgula — 1234,56",
  "Point — 1234.56":
    "Ponto — 1234.56",
  "Relire le fichier avec ces réglages":
    "Reler o arquivo com estas configurações",
  "La plupart des lignes sont illisibles : le fichier n'utilise sans doute pas le délimiteur ou le séparateur décimal détectés automatiquement. Précise-les ci-dessous, puis relis le fichier.":
    "A maioria das linhas está ilegível: o arquivo provavelmente não usa o delimitador ou o separador decimal detectados automaticamente. Indique-os abaixo e releia o arquivo.",
  "Preset":
    "Predefinição",
  "+ Nouveau preset":
    "+ Nova predefinição",
  "Renommer":
    "Renomear",
  "Supprimer ce preset":
    "Excluir esta predefinição",
  "Compte bancaire de ce preset":
    "Conta bancária desta predefinição",
  "— aucun : le compte vient du fichier —":
    "— nenhuma: a conta vem do arquivo —",
  "Configuration du fichier":
    "Configuração do arquivo",
  "Comparaison des doublons":
    "Comparação de duplicatas",
  "Comparer":
    "Comparar",
  "toutes les colonnes, sauf celles-ci":
    "todas as colunas, exceto estas",
  "uniquement ces colonnes":
    "somente estas colunas",
  "Compte bancaire":
    "Conta bancária",
  "Montant envoyé":
    "Valor enviado",
  "Monnaie envoyée":
    "Moeda enviada",
  "Frais":
    "Tarifas",
  "Monnaie des frais":
    "Moeda das tarifas",
  "État":
    "Estado",
  "Montant au débit":
    "Valor no débito",
  "Montant au crédit":
    "Valor no crédito",
  "Mots-clés de la colonne « Sens »":
    "Palavras-chave da coluna « Sentido »",
  "Sortie (argent qui part)":
    "Saída (dinheiro que sai)",
  "Par défaut :":
    "Padrão:",
  "Entrée (argent qui rentre)":
    "Entrada (dinheiro que entra)",
  "Mots-clés de la colonne « État »":
    "Palavras-chave da coluna « Estado »",
  "Entrée":
    "Entrada",
  "Exécuté":
    "Executado",
  "Refusé / annulé":
    "Recusado / cancelado",
  "Débit":
    "Débito",
  "Crédit":
    "Crédito",
  "Refusé":
    "Recusado",
  "Exécuté (l'argent a bougé)":
    "Executado (o dinheiro se moveu)",
  "En attente → opération prévisionnelle":
    "Pendente → transação prevista",
  "Refusé / annulé → ligne non importée":
    "Recusado / cancelado → linha não importada",
  "Enregistrer la configuration":
    "Salvar a configuração",
  "Compte pour ce fichier (aucune colonne \"Compte bancaire\" configurée)":
    "Conta para este arquivo (nenhuma coluna \"Conta bancária\" configurada)",
  "— choisir —":
    "— escolher —",
  "Sélectionner un fichier Excel ou CSV":
    "Selecionar um arquivo Excel ou CSV",
  "ou glisse-dépose ton fichier ici — l'analyse démarre automatiquement":
    "ou arraste e solte seu arquivo aqui — a análise começa sozinha",
  "Le fichier tel qu'il est":
    "O arquivo como ele é",
  "Catégories bancaires à confirmer":
    "Categorias bancárias a confirmar",
  "Tout confirmer":
    "Confirmar tudo",
  "Comptes bancaires à faire correspondre":
    "Contas bancárias a associar",
  "Devises à faire correspondre":
    "Moedas a associar",
  "Devises déjà rattachées":
    "Moedas já vinculadas",
  "Aperçu —":
    "Pré-visualização —",
  "ligne(s)":
    "linha(s)",
  "Tout sélectionner":
    "Selecionar tudo",
  "Supprimer la sélection (":
    "Excluir a seleção (",
  "Opérations classiques —":
    "Transações padrão —",
  "Ligne":
    "Linha",
  "Catégorie (banque)":
    "Categoria (banco)",
  "Compte (banque)":
    "Conta (banco)",
  "Sélection":
    "Seleção",
  "Dépenses remboursables —":
    "Despesas reembolsáveis —",
  "Remboursements reçus —":
    "Reembolsos recebidos —",
  "Virements internes —":
    "Transferências internas —",
  "Compte émetteur":
    "Conta de origem",
  "Compte récepteur":
    "Conta de destino",
  "Prêts reçus —":
    "Empréstimos recebidos —",
  "Remboursements de prêts —":
    "Pagamentos de empréstimos —",
  "Ressemblances —":
    "Semelhanças —",
  "Veille des doublons de virement : {compares} ligne(s) comparée(s) sur {total}":
    "Vigília de duplicatas de transferência: {compares} linha(s) comparada(s) de {total}",
  "{n} ressemblance(s) trouvée(s).":
    "{n} semelhança(s) encontrada(s).",
  "aucune ressemblance.":
    "nenhuma semelhança.",
  "{n} ligne(s) n'ont pas pu être comparées : il leur manque une date ou un compte reconnu.":
    "{n} linha(s) não puderam ser comparadas: falta uma data ou uma conta reconhecida.",
  "transaction":
    "transação",
  "Émetteur":
    "Remetente",
  "Récepteur":
    "Destinatário",
  "Compte lu sur l'opération à laquelle cette ligne ressemble. Rien n'est enregistré : reprends-le par « Modifier » si tu veux vraiment importer cette ligne.":
    "Conta lida na transação com a qual esta linha se parece. Nada é gravado: retome-a por « Modificar » se você realmente quiser importar esta linha.",
  "Doublons détectés —":
    "Duplicatas detectadas —",
  "Confirmer l'import":
    "Confirmar a importação",
  "Historique des importations":
    "Histórico de importações",
  "Fichier":
    "Arquivo",
  "Opérations créées":
    "Transações criadas",
  "Lignes ignorées":
    "Linhas ignoradas",
  "Doublons détectés":
    "Duplicatas detectadas",
  "Supprimer cette monnaie ?":
    "Excluir esta moeda?",
  "Monnaie supprimée":
    "Moeda excluída",
  "Monnaie modifiée":
    "Moeda modificada",
  "Monnaie créée":
    "Moeda criada",
  "Renseigne le chemin complet du fichier .db.":
    "Informe o caminho completo do arquivo .db.",
  "Supprimer ce compte ?":
    "Excluir esta conta?",
  "Compte supprimé":
    "Conta excluída",
  "Type de compte modifié":
    "Tipo de conta modificado",
  "Ordre des comptes modifié":
    "Ordem das contas modificada",
  "Choisis au moins une monnaie pour ce compte.":
    "Escolha pelo menos uma moeda para esta conta.",
  "Compte modifié":
    "Conta modificada",
  "Compte créé":
    "Conta criada",
  "Supprimer cette catégorie ?":
    "Excluir esta categoria?",
  "Catégorie supprimée":
    "Categoria excluída",
  "Catégorie créée":
    "Categoria criada",
  "Supprimer cette opération ?":
    "Excluir esta transação?",
  "Opération supprimée":
    "Transação excluída",
  "Renseigne le montant reçu : les deux comptes sont dans des monnaies différentes ":
    "Informe o valor recebido: as duas contas estão em moedas diferentes ",
  "Virement modifié":
    "Transferência modificada",
  "Virement créé":
    "Transferência criada",
  "La nature de l'opération est obligatoire.":
    "A descrição da transação é obrigatória.",
  "Renseigne un montant réglé pour au moins une opération.":
    "Informe um valor quitado para pelo menos uma transação.",
  "Opération modifiée":
    "Transação modificada",
  "Opération créée":
    "Transação criada",
  "Prêt modifié":
    "Empréstimo modificado",
  "Prêt créé":
    "Empréstimo criado",
  "Supprimer TOUTES les opérations ? Action irréversible — pensé pour vider des données de test.":
    "Excluir TODAS as transações? Ação irreversível — pensada para limpar dados de teste.",
  "Cours mis à jour":
    "Cotação atualizada",
  "Supprimer ce titre ?":
    "Excluir este título?",
  "Titre supprimé":
    "Título excluído",
  "Supprimer ce mouvement ? Le solde du compte sera recalculé.":
    "Excluir este movimento? O saldo da conta será recalculado.",
  "Mouvement supprimé":
    "Movimento excluído",
  "Titre ajouté":
    "Título adicionado",
  "Preset renommé":
    "Predefinição renomeada",
  "Preset supprimé":
    "Predefinição excluída",
  "Configuration enregistrée":
    "Configuração salva",
  "Configuration enregistrée, fichier relu.":
    "Configuração salva, arquivo relido.",
  "Fermer ce message":
    "Fechar esta mensagem",
  "Thème":
    "Tema",
  "Sombre":
    "Escuro",
  "Clair":
    "Claro",
  "Choisis d'abord un fichier à analyser.":
    "Escolha primeiro um arquivo para analisar.",
  "Aucun preset d'import disponible : crées-en un d'abord.":
    "Nenhuma predefinição de importação disponível: crie uma primeiro.",
  "Un aperçu est déjà en cours : analyser ce fichier l'abandonnera (lignes en attente comprises). Continuer ?":
    "Uma pré-visualização já está aberta: analisar este arquivo a abandonará (linhas pendentes incluídas). Continuar?",
  "Ce compte ne porte aucune monnaie : impossible de créer l'opération.":
    "Esta conta não tem nenhuma moeda: não é possível criar a transação.",
  "Renseigne une date valide.":
    "Informe uma data válida.",
  "La nature ne peut pas être vide.":
    "A descrição não pode ficar vazia.",
  "Choisis un compte.":
    "Escolha uma conta.",
  "Le compte émetteur et le compte récepteur doivent être différents, sauf pour une ":
    "A conta de origem e a conta de destino devem ser diferentes, exceto para uma ",
  "Renseigne le montant envoyé : les deux monnaies diffèrent et l'app ne convertit rien.":
    "Informe o valor enviado: as duas moedas diferem e o app não converte nada.",
  "Choisis une catégorie.":
    "Escolha uma categoria.",
  "Termine maintenant les remboursements / remboursements de prêts en attente, ci-dessous.":
    "Conclua agora os reembolsos / pagamentos de empréstimos pendentes, abaixo.",
  "Correspondance supprimée":
    "Correspondência excluída",
  "Correspondance reclassée":
    "Correspondência reclassificada",
  "Correspondance mise à jour":
    "Correspondência atualizada",
  "Mapping mis à jour":
    "Mapeamento atualizado",
  "Mapping supprimé":
    "Mapeamento excluído",
  "Règle supprimée":
    "Regra excluída",
  "Donne un nom à la règle.":
    "Dê um nome à regra.",
  "Chaque condition doit porter sur un champ.":
    "Cada condição deve apontar para um campo.",
  "Chaque condition doit avoir une valeur à comparer.":
    "Cada condição deve ter um valor a comparar.",
  "Règle modifiée":
    "Regra modificada",
  "Règle créée":
    "Regra criada",
  "Monnaie introuvable":
    "Moeda não encontrada",
  "Un titre avec ce nom existe déjà":
    "Já existe um título com este nome",
  "Titre introuvable":
    "Título não encontrado",
  "Une catégorie avec ce nom existe déjà":
    "Já existe uma categoria com este nome",
  "mois doit être entre 1 et 12":
    "o mês deve estar entre 1 e 12",
  "Catégorie introuvable":
    "Categoria não encontrada",
  "La catégorie 'Autres' ne peut pas être supprimée":
    "A categoria 'Autres' não pode ser excluída",
  "Type de compte introuvable":
    "Tipo de conta não encontrado",
  "Une même monnaie ne peut pas être ajoutée deux fois":
    "A mesma moeda não pode ser adicionada duas vezes",
  "Un compte avec ce nom existe déjà":
    "Já existe uma conta com este nome",
  "Compte introuvable":
    "Conta não encontrada",
  "Impossible de supprimer un compte qui a des opérations liées":
    "Não é possível excluir uma conta que tem transações vinculadas",
  "vue doit être 'mois' ou 'annee'":
    "a visão deve ser 'mois' ou 'annee'",
  "Preset d'import introuvable":
    "Predefinição de importação não encontrada",
  "Au moins une colonne est requise":
    "Pelo menos uma coluna é necessária",
  "Chaque propriété ne peut être assignée qu'à une seule colonne":
    "Cada propriedade só pode ser atribuída a uma única coluna",
  "Chaque colonne ne peut être utilisée qu'une fois":
    "Cada coluna só pode ser usada uma vez",
  "Les colonnes de la comparaison doivent être numérotées à partir de 1":
    "As colunas da comparação devem ser numeradas a partir de 1",
  "Impossible de supprimer le dernier preset restant":
    "Não é possível excluir a última predefinição restante",
  "Mapping introuvable":
    "Mapeamento não encontrado",
  "mappings invalide (JSON attendu)":
    "mapeamentos inválidos (JSON esperado)",
  "Une monnaie avec ce nom existe déjà":
    "Já existe uma moeda com este nome",
  "Type d'opération introuvable":
    "Tipo de transação não encontrado",
  "Opération introuvable":
    "Transação não encontrada",
  "montant_du ne peut pas dépasser montant":
    "montant_du não pode ultrapassar montant",
  "montant_a_rembourser ne peut pas dépasser montant_du":
    "montant_a_rembourser não pode ultrapassar montant_du",
  "Ce compte n'est pas un compte de placements financiers":
    "Esta não é uma conta de investimentos",
  "Mouvement de titres introuvable":
    "Movimento de títulos não encontrado",
  "Règle introuvable":
    "Regra não encontrada",
  "Compte en face introuvable":
    "Conta de destino não encontrada",
  "Ce type de compte est protégé (utilisé par les règles de l'application) et ne peut pas être supprimé":
    "Este tipo de conta é protegido (usado pelas regras do aplicativo) e não pode ser excluído",
  "Impossible de supprimer un type utilisé par au moins un compte":
    "Não é possível excluir um tipo usado por pelo menos uma conta",
  "Compte source introuvable":
    "Conta de origem não encontrada",
  "Compte destination introuvable":
    "Conta de destino não encontrada",
  "Virement introuvable":
    "Transferência não encontrada",
  "frequence est requise pour une opération récurrente":
    "frequence é obrigatória para uma transação recorrente",
  "la valeur à comparer ne peut pas être vide":
    "o valor a comparar não pode ficar vazio",
  "date illisible":
    "data ilegível",
  "montant illisible":
    "valor ilegível",
  "nature manquante":
    "descrição ausente",
  "catégorie non résolue":
    "categoria não resolvida",
  "compte non résolu":
    "conta não resolvida",
  "frais dans une monnaie étrangère aux montants de la ligne":
    "tarifas em uma moeda alheia aos valores da linha",
  "virement interne : le compte en face n'est pas renseigné":
    "transferência interna: a conta de destino não foi informada",
  "monnaie des frais manquante":
    "moeda das tarifas ausente",
  "sens manquant":
    "sentido ausente",
  "montant présent au débit et au crédit":
    "valor presente no débito e no crédito",
  "virement interne : le sens de la ligne est indéterminé":
    "transferência interna: o sentido da linha é indeterminado",
  "état manquant":
    "estado ausente",
  "frais supérieurs au montant de la ligne":
    "tarifas maiores que o valor da linha",
  "compte introuvable":
    "conta não encontrada",
  "Modifier":
    "Modificar",
  "Supprimer":
    "Excluir",
  "Confirmer":
    "Confirmar",
  "Remboursé":
    "Reembolsado",
  "En attente":
    "Pendente",
  "OK":
    "OK",
  "Portefeuille":
    "Carteira",
  "Total du compte":
    "Total da conta",
  "Plus-value latente":
    "Ganho latente",
  "Liquidités disponibles pour acheter":
    "Dinheiro disponível para comprar",
  "Titres détenus, au dernier cours saisi":
    "Títulos em carteira, pela última cotação informada",
  "Espèces + portefeuille":
    "Dinheiro + carteira",
  "Valorisation − capital investi":
    "Valorização − capital investido",
  "Aucune monnaie.":
    "Nenhuma moeda.",
  "Aucun compte.":
    "Nenhuma conta.",
  "Aucun compte dans cette monnaie.":
    "Nenhuma conta nesta moeda.",
  "Aucune dépense enregistrée.":
    "Nenhuma despesa registrada.",
  "Détailler par semaine":
    "Detalhar por semana",
  "Moyenne":
    "Média",
  "Replier les semaines":
    "Recolher as semanas",
  "année {annee}":
    "ano {annee}",
  "du {debut} au {fin} {mois}":
    "de {debut} a {fin} {mois}",
  "moyenne des {n} semaines de {mois}":
    "média das {n} semanas de {mois}",
  "on te doit":
    "devem a você",
  "tu dois":
    "você deve",
  "Revenir à la base de l'application":
    "Voltar ao banco do aplicativo",
  "Revenir à la base de l'application ? La base actuellement ouverte est simplement refermée — aucun fichier n'est modifié ni supprimé.":
    "Voltar ao banco do aplicativo? O banco atualmente aberto é simplesmente fechado — nenhum arquivo é modificado nem excluído.",
  "Insérer une fonction ou une grandeur": "Inserir uma função ou uma grandeza",
  "Fonctions": "Funções",
  "Grandeurs": "Grandezas",
  "Montant reçu": "Valor recebido",
  "Montant envoyé": "Valor enviado",
  "Devise du montant reçu": "Moeda do valor recebido",
  "Devise du montant envoyé": "Moeda do valor enviado",
  "un libellé de devise": "um rótulo de moeda",
  "la devise du montant envoyé": "a moeda do valor enviado",
  "la devise du montant reçu": "a moeda do valor recebido",
  "ex. 50 ou montant_envoye * 1,02": "ex. 50 ou montant_envoye * 1,02",
  "Un nombre, ou une formule qui compare ce montant à un autre : « montant_envoye * 1,02 », « min(montant_recu; 50) ». L'icône ƒ à gauche du champ propose les fonctions (max, min, et reste dans une découpe) et les grandeurs de la ligne : le montant reçu (ce qui arrive) et le montant envoyé (ce qui part). Quand le relevé n'a pas de colonne de montant envoyé, les deux valent le montant de la ligne.":
    "Um número, ou uma fórmula que compara este valor a outro: “montant_envoye * 1,02”, “min(montant_recu; 50)”. O ícone ƒ à esquerda do campo oferece as funções (max, min, e reste numa divisão) e as grandezas da linha: o valor recebido (o que chega) e o valor enviado (o que sai). Quando o extrato não tem coluna de valor enviado, os dois valem o valor da linha.",
  "Le libellé de devise tel que le relevé l'écrit (« EUR », « $ »), pas la monnaie de l'app : une règle se lit avant que la devise soit rattachée. Compare-la à un libellé, ou à la devise de l'autre montant pour repérer un mouvement entre deux devises différentes.":
    "O rótulo de moeda como o extrato o escreve (“EUR”, “$”), não a moeda do app: uma regra é lida antes de a moeda ser associada. Compare-o a um rótulo, ou à moeda do outro valor para identificar um movimento entre duas moedas diferentes.",
  "À choisir":
    "A escolher",
  "à {n} jour(s) d'écart":
    "com {n} dia(s) de diferença",
  "virement déjà connu : à valider":
    "transferência já conhecida: a validar",
  "même virement — non importé":
    "mesma transferência — não importada",
  "Le type ou le compte en face a été changé : la ligne n'est plus ce que l'app avait lu.":
    "O tipo ou a conta de contrapartida foi alterado: a linha não é mais o que o app tinha lido.",
  "Tout valider : « Oui »":
    "Validar tudo: “Sim”",
  "Virements déjà connus":
    "Transferências já conhecidas",
  "Même virement ?":
    "Mesma transferência?",
  "Virement déjà connu":
    "Transferência já conhecida",
  "Ligne du relevé":
    "Linha do extrato",
  "Quand tu as importé ce virement depuis l'autre compte, l'app a aussi écrit la jambe de celui-ci : la ligne ci-dessous lui ressemble (même compte, même sens, même montant, date voisine). « Oui » = c'est le même virement : la ligne n'est pas importée, et ses colonnes sont retenues pour que le prochain relevé la reconnaisse sans te redemander. « Non » = c'est une autre opération, elle est importée. Si tu changes le type de la ligne ou son compte en face, le choix passe en « Non » tout seul. L'import est bloqué tant qu'un choix reste « à choisir ».":
    "Quando você importou esta transferência a partir da outra conta, o app também registrou a perna desta conta: a linha abaixo se parece com ela (mesma conta, mesmo sentido, mesmo valor, data próxima). “Sim” = é a mesma transferência: a linha não é importada, e suas colunas são guardadas para que o próximo extrato a reconheça sem perguntar de novo. “Não” = é outra transação, e ela é importada. Se você mudar o tipo da linha ou sua conta de contrapartida, a escolha passa para “Não” sozinha. A importação fica bloqueada enquanto uma escolha estiver “a escolher”.",
  "Entrées et dépenses":
    "Entradas e despesas",
  "Entrées et dépenses du projet":
    "Entradas e despesas do projeto",
  "Entrées":
    "Entradas",
  "Solde":
    "Saldo",
  "Les entrées du projet, puis chaque catégorie de dépense qui les entame (de la plus lourde à la plus légère), puis ce qu'il en reste. Sous zéro, le projet a coûté plus qu'il n'a rapporté. Une cascade par monnaie.":
    "As entradas do projeto, depois cada categoria de despesa que as reduz (da maior à menor), depois o que sobra. Abaixo de zero, o projeto custou mais do que rendeu. Uma cascata por moeda.",
  "— toutes —": "— todas —",
  "Remboursé via : {details}. Le montant de l'opération est figé tant que ce lien existe. Le montant à rembourser peut encore changer, sans descendre sous ce qui est déjà remboursé ({deja}) — pour aller plus bas, délie d'abord l'opération de remboursement correspondante.":
    "Reembolsado via: {details}. O valor da transação fica congelado enquanto esse vínculo existir. O valor a reembolsar ainda pode mudar, sem ficar abaixo do que já foi reembolsado ({deja}) — para ir mais baixo, desvincule primeiro a transação de reembolso correspondente.",
  "Possibles doublons de virements internes —": "Possíveis duplicatas de transferências internas —",
  "Jambe en face identifiée —": "Perna de contrapartida identificada —",
  "Ajouter un taux de change": "Adicionar uma taxa de câmbio",
  "Annuler la déclaration": "Desfazer a declaração",
  "C'est le même virement (ne pas importer)": "É a mesma transferência (não importar)",
  "La somme des parts doit valoir le montant de l'opération.": "A soma das partes deve ser igual ao valor da transação.",
  "Active":
    "Ativa",
  "Monnaie éteinte : plus proposée à la saisie ni devinée à l'import. Ses opérations sont toujours en base.":
    "Moeda desligada: não é mais oferecida na entrada de transações nem adivinhada na importação. Suas transações continuam no banco.",
  "Décoche pour que cette monnaie ne soit plus proposée à la saisie ni devinée à l'import. Les opérations déjà enregistrées restent en base.":
    "Desmarque para que esta moeda não seja mais oferecida na entrada de transações nem adivinhada na importação. As transações já registradas continuam no banco.",
  "Le solde de ce compte dans cette monnaie n'est pas nul : vire ce qui reste ailleurs avant d'éteindre.":
    "O saldo desta conta nesta moeda não é zero: transfira o que sobra para outro lugar antes de desligar.",
  "Désactiver":
    "Desativar",
  "Réactiver":
    "Reativar",
  "Compte désactivé":
    "Conta desligada",
  "Compte réactivé":
    "Conta religada",
  "Catégorie désactivée":
    "Categoria desligada",
  "Catégorie réactivée":
    "Categoria religada",
  "Suivi des remboursements":
    "Acompanhamento de reembolsos",
  "← Retour au tableau de bord":
    "← Voltar ao painel",
  "Qui te doit combien, et à qui tu dois. Un profil est une étiquette : une personne, une entreprise, la colocation. Rien n'est recalculé ailleurs — les soldes, le dashboard et l'histogramme donnent exactement les mêmes chiffres, cet écran ne fait que les ventiler.":
    "Quem deve quanto a você, e a quem você deve. Um perfil é um rótulo: uma pessoa, uma empresa, a república. Nada é recalculado em outro lugar — os saldos, o painel e o histograma dão exatamente os mesmos números, esta tela apenas os detalha.",
  "Rien à suivre pour l'instant : aucune dépense remboursable ni aucun prêt reçu n'attend de règlement. Les lignes apparaîtront ici dès qu'il en existera une.":
    "Nada a acompanhar por enquanto: nenhuma despesa reembolsável nem empréstimo recebido aguarda acerto. As linhas aparecerão aqui assim que existir uma.",
  "On te doit":
    "Devem a você",
  "Tu dois":
    "Você deve",
  "Solde net":
    "Saldo líquido",
  "Le reste dû de tes dépenses remboursables, celles que tu as avancées. Une ligne par monnaie : rien n'est additionné d'une devise à l'autre. Seules les opérations réelles comptent.":
    "O que ainda é devido das suas despesas reembolsáveis, as que você adiantou. Uma linha por moeda: nada é somado de uma moeda para outra. Só contam as transações reais.",
  "Le reste dû de tes prêts reçus, une ligne par monnaie. Nécessite l'extension « Prêts » pour qu'il existe des prêts à suivre.":
    "O que ainda é devido dos seus empréstimos recebidos, uma linha por moeda. Requer a extensão « Prêts » para que haja empréstimos a acompanhar.",
  "Ce qu'on te doit moins ce que tu dois, DANS chaque monnaie — jamais entre elles. C'est le même chiffre que la carte « Reste à rembourser » du tableau de bord, qui n'en montre qu'une à la fois.":
    "O que devem a você menos o que você deve, DENTRO de cada moeda — nunca entre elas. É o mesmo número do cartão « Reste à rembourser » do painel, que mostra só uma por vez.",
  "Qui doit combien":
    "Quem deve quanto",
  "Une ligne par profil, et à l'intérieur une barre par monnaie où il porte quelque chose. La barre va à droite quand on te doit, à gauche quand tu dois ; sa longueur se compare au plus gros solde de SA monnaie — deux devises ne se comparent jamais. Clique une ligne pour voir ses opérations.":
    "Uma linha por perfil e, dentro dela, uma barra por moeda em que ele carrega algo. A barra vai para a direita quando devem a você, para a esquerda quando você deve; seu comprimento se compara ao maior saldo DA SUA moeda — duas moedas nunca se comparam. Clique em uma linha para ver suas transações.",
  "À rattacher":
    "A vincular",
  "Les dépenses remboursables et les prêts encore dus qu'aucun profil ne porte. Coche des lignes, choisis un profil, et le tableau du dessus se met à jour.":
    "As despesas reembolsáveis e os empréstimos ainda devidos que nenhum perfil carrega. Marque linhas, escolha um perfil, e a tabela de cima se atualiza.",
  "Profils":
    "Perfis",
  "Une étiquette, et rien de plus : aucun calcul de l'application ne la lit. En supprimer un détache ses opérations, il ne les efface jamais.":
    "Um rótulo, e nada mais: nenhum cálculo do aplicativo o lê. Excluir um perfil desvincula suas transações, nunca as apaga.",
  "Ajouter un profil":
    "Adicionar um perfil",
  "Ajouter le profil":
    "Adicionar o perfil",
  "ex. Marie":
    "ex. Marie",
  "Note":
    "Nota",
  "ex. voisine du dessus, rembourse en fin de mois":
    "ex. vizinha de cima, paga no fim do mês",
  "Sans profil":
    "Sem perfil",
  "ligne":
    "linha",
  "lignes":
    "linhas",
  "Règlement":
    "Acerto",
  "Reste dû":
    "Resta devido",
  "Tout cocher":
    "Marcar tudo",
  "Rattacher au profil":
    "Vincular ao perfil",
  "Rattacher la sélection":
    "Vincular a seleção",
  "Coche au moins une ligne à rattacher.":
    "Marque pelo menos uma linha para vincular.",
  "Opérations rattachées.":
    "Transações vinculadas.",
  "Opération détachée.":
    "Transação desvinculada.",
  "Aucune opération rattachée à ce profil.":
    "Nenhuma transação vinculada a este perfil.",
  "Crée d'abord un profil ci-dessous, puis reviens rattacher ces lignes.":
    "Crie primeiro um perfil abaixo, depois volte para vincular estas linhas.",
  "Aucun profil. Ajoute-en un ci-dessous : c'est à eux que se rattachent les lignes.":
    "Nenhum perfil. Adicione um abaixo: é a eles que as linhas se vinculam.",
  "Glisser pour réordonner":
    "Arraste para reordenar",
  "Supprimer le profil":
    "Excluir o perfil",
  "Ses opérations ne sont pas supprimées : elles retournent dans « Sans profil ».":
    "Suas transações não são excluídas: elas voltam para « Sem perfil ».",
  "Répartition par catégorie":
    "Distribuição por categoria",
  "Les sorties du projet, réparties par catégorie — virements sortants compris, comme dans le total ci-dessus. Les entrées n'y figurent pas : elles se lisent dans le total des entrées.":
    "As saídas do projeto, distribuídas por categoria — transferências de saída incluídas, como no total acima. As entradas não aparecem aqui: elas se leem no total das entradas.",
  "ex. la banque écrit « VIR RECU M DUPONT » pour les remboursements de Paul":
    "ex. o banco escreve « VIR RECU M DUPONT » para os reembolsos do Paul",
  "ex. ce courtier écrit « ACHAT COMPTANT » suivi du nom du titre":
    "ex. esta corretora escreve « ACHAT COMPTANT » seguido do nome do título",
  "Aucune opération sur la période.":
    "Nenhuma transação no período.",
  "Sans libellé":
    "Sem descrição",
  "La catégorie que ta banque a posée elle-même sur la ligne.\n\nElle ne devient pas une catégorie de l'app toute seule : tu fais le rapprochement une fois, il est retenu.":
    "A categoria que o seu banco colocou na linha.\n\nEla não vira uma categoria do app sozinha: você faz a correspondência uma vez e ela é memorizada.",
  "Le compte concerné, quand le fichier le nomme.\n\nInutile si le preset est déjà lié à un compte : ce lien vaut pour toutes les lignes.":
    "A conta em questão, quando o arquivo a nomeia.\n\nInútil se a predefinição já estiver ligada a uma conta: esse vínculo vale para todas as linhas.",
  "À régler seulement si ton relevé n'écrit que des montants positifs et dit à part si l'argent entre ou sort.\n\nLes mots-clés reconnus se règlent juste en dessous.":
    "Só precisa configurar se o seu extrato escreve apenas valores positivos e diz à parte se o dinheiro entra ou sai.\n\nAs palavras-chave reconhecidas são definidas logo abaixo.",
  "La devise du montant.\n\nSans elle, la ligne part dans la monnaie principale de son compte — faux dès qu'un compte en porte plusieurs.":
    "A moeda do valor.\n\nSem ela, a linha vai para a moeda principal da conta — errado assim que uma conta tem várias.",
  "Ce qui PART du compte, avant frais et avant conversion ; « Montant » décrit alors ce qui ARRIVE.\n\nC'est le couple qu'il faut pour importer un virement entre deux devises : seul ton relevé connaît les deux montants.":
    "O que SAI da conta, antes das tarifas e da conversão; « Valor » descreve então o que CHEGA.\n\nÉ o par necessário para importar uma transferência entre duas moedas: só o seu extrato conhece os dois valores.",
  "La devise du montant envoyé.\n\nSans elle, l'app la suppose identique à celle du montant reçu, donc sans change.":
    "A moeda do valor enviado.\n\nSem ela, o app a supõe igual à do valor recebido, portanto sem câmbio.",
  "Les frais prélevés par la banque.\n\nC'est leur DEVISE qui décide auquel des deux montants ils se rapportent : dans la monnaie envoyée ils s'y ajoutent, dans celle reçue ils s'en retranchent. Dans une troisième, l'import est refusé plutôt que de fausser un solde.":
    "As tarifas cobradas pelo banco.\n\nÉ a MOEDA delas que decide a qual dos dois valores se referem: na moeda enviada elas se somam, na recebida são subtraídas. Em uma terceira, a importação é recusada em vez de falsear um saldo.",
  "La devise des frais, celle qui dit à quel montant ils s'appliquent.\n\nSans elle, l'app les rattache au montant envoyé et te le signale à chaque import.":
    "A moeda das tarifas, a que diz a qual valor elas se aplicam.\n\nSem ela, o app as associa ao valor enviado e avisa você a cada importação.",
  "Le montant de la ligne, avec son signe : négatif il sort, positif il entre.\n\nSi ton relevé sépare sorties et entrées en deux colonnes, éteins celle-ci et règle « Montant au débit » et « Montant au crédit ».":
    "O valor da linha, com o sinal: negativo sai, positivo entra.\n\nSe o seu extrato separa saídas e entradas em duas colunas, desligue esta e configure « Valor no débito » e « Valor no crédito ».",
  "Pour les relevés qui SÉPARENT sorties et entrées en deux colonnes, chaque ligne n'en remplissant qu'une.\n\nLa colonne remplie dit le sens. Un zéro vaut une case vide, une ligne qui remplit les deux part en erreur.":
    "Para extratos que SEPARAM saídas e entradas em duas colunas, cada linha preenchendo apenas uma.\n\nA coluna preenchida indica o sentido. Um zero vale uma caixa vazia; uma linha que preenche as duas vai para erro.",
  "L'autre moitié : ce qui ENTRE.\n\nElle va toujours avec « Montant au débit » — allumer ou éteindre l'une fait la même chose à l'autre.":
    "A outra metade: o que ENTRA.\n\nEla sempre anda com « Valor no débito » — ligar ou desligar uma faz o mesmo com a outra.",
  "Où en est l'opération chez ta banque.\n\nUne ligne en attente devient une opération prévisionnelle, une ligne refusée n'est pas importée. Les mots-clés se règlent plus bas.":
    "Em que pé está a transação no seu banco.\n\nUma linha pendente vira uma transação prevista, uma linha recusada não é importada. As palavras-chave são definidas mais abaixo.",
  "Le nombre de titres que tu DÉTIENS au moment de la photographie.\n\nC'est cette quantité qui part en base : l'app ne sait pas comment tu y es arrivé, seulement ce que tu as.":
    "O número de títulos que você DETÉM no momento da posição.\n\nÉ essa quantidade que vai para o banco: o app não sabe como você chegou lá, apenas o que você tem.",
  "Ce qu'UN titre t'a coûté en moyenne, frais compris (le PRU).\n\nPar titre, pas le total investi. Si ton relevé donne le total, divise-le avant d'importer.":
    "O que UM título custou a você em média, tarifas incluídas (o preço médio).\n\nPor título, não o total investido. Se o seu extrato dá o total, divida-o antes de importar.",
  "Ce que la ligne vaut aujourd'hui, tous titres confondus.\n\nElle ne crée aucune détention : elle sert à déduire le cours du titre (valeur ÷ quantité), que ce genre d'export ne donne pas.":
    "O que a linha vale hoje, todos os títulos somados.\n\nEla não cria nenhuma posição: serve para deduzir a cotação do título (valor ÷ quantidade), que esse tipo de exportação não fornece.",
  "Ce que la ligne décrit : un achat, une vente, ou un transfert d'espèces.\n\nLes mots-clés se règlent juste en dessous. Un libellé inconnu met la ligne en erreur plutôt que d'être deviné.":
    "O que a linha descreve: uma compra, uma venda ou uma transferência de dinheiro.\n\nAs palavras-chave são definidas logo abaixo. Uma descrição desconhecida coloca a linha em erro em vez de ser adivinhada.",
  "Le nom du titre tel que ton courtier l'écrit.\n\nFacultatif si tu lis l'ISIN, mais il faut l'un des deux : sans eux, une ligne d'achat ne dit pas de quelle valeur elle parle.":
    "O nome do título como a sua corretora o escreve.\n\nOpcional se você ler o ISIN, mas é preciso um dos dois: sem eles, uma linha de compra não diz de qual ativo se trata.",
  "Le code ISIN du titre (FR0000120073, LU1681043599…).\n\nSeul nom qui ne change jamais : c'est par lui qu'un titre est reconnu d'un import à l'autre. Facultatif si tu lis le nom de la valeur.":
    "O código ISIN do título (FR0000120073, LU1681043599…).\n\nÉ o único nome que nunca muda: é por ele que um título é reconhecido de uma importação para a outra. Opcional se você ler o nome do ativo.",
  "Ce que l'opération a coûté ou rapporté en espèces.\n\nC'est lui qui fait foi : le prix par titre vaut montant ÷ quantité, pas le cours annoncé. Ton solde colle ainsi au relevé, frais de courtage compris.":
    "O que a transação custou ou rendeu em dinheiro.\n\nÉ ELE que vale: o preço por título é valor ÷ quantidade, não a cotação anunciada. Seu saldo bate assim com o extrato, corretagem incluída.",
  "Le prix par titre annoncé par le relevé.\n\nIl ne décide de rien, il sert de contrôle : un écart de plus de 1 % avec le montant divisé par la quantité est signalé au-dessus de l'aperçu, sans bloquer l'import.":
    "O preço por título anunciado pelo extrato.\n\nEle não decide nada, serve de verificação: uma diferença de mais de 1 % em relação ao valor dividido pela quantidade é sinalizada acima da pré-visualização, sem bloquear a importação.",
  "L'étiquette du titre, si ton fichier la porte : ETF, obligation, action…\n\nFacultative, et sans effet sur un montant. Un libellé que tu n'as pas encore créé le sera à l'import. Un titre que l'app connaît déjà garde le type que tu lui as posé.":
    "O rótulo do título, se o seu arquivo o traz: ETF, título de renda fixa, ação…\n\nOpcional, e sem efeito sobre nenhum valor. Um rótulo que você ainda não criou será criado na importação. Um título que o app já conhece mantém o tipo que você definiu.",
  "Un preset par courtier : colonnes à lire et vocabulaire de ses relevés. Ceux des relevés bancaires vivent à part, sur la page Import.":
    "Uma predefinição por corretora: colunas a ler e vocabulário dos extratos dela. Os dos extratos bancários vivem à parte, na página Importação.",
  "Un relevé de courtier ne dit jamais quel compte il décrit. Le lier ici évite de le choisir à chaque import ; laisse vide si plusieurs comptes ont le même format.":
    "Um extrato de corretora nunca diz qual conta ele descreve. Vinculá-lo aqui evita escolher a cada importação; deixe vazio se várias contas têm o mesmo formato.",
  "Comment l'app reconnaît une ligne déjà importée sous ce preset. Soit toutes les colonnes moins celles qui bougent d'un export à l'autre (numéro d'ordre, solde courant), soit les seules qui identifient une ligne — souvent date + valeur + montant + quantité.":
    "Como o app reconhece uma linha já importada sob esta predefinição. Ou todas as colunas menos as que mudam de uma exportação para outra (número de ordem, saldo corrente), ou só as que identificam uma linha — geralmente data + ativo + valor + quantidade.",
  "L'app ne connaît pas encore ces valeurs et les créera à l'import. Si l'une existe déjà chez toi sous un autre nom, choisis-la à la main sur sa ligne.":
    "O app ainda não conhece estes ativos e os criará na importação. Se algum já existe aí com outro nome, escolha-o à mão na linha dele.",
  "Une étiquette posée sur le titre que la ligne désigne — ETF, obligation, action. Uniquement à la création d'un titre : un titre déjà typé garde le sien. Purement descriptif.":
    "Um rótulo colocado no título que a linha designa — ETF, renda fixa, ação. Somente na criação de um título: um título já classificado mantém o seu. Puramente descritivo.",
  "Aucun titre détenu sur ce compte.":
    "Nenhum título em carteira nesta conta.",
  "Aucun mouvement.":
    "Nenhum movimento.",
  "Aucun compte — dépose-en un ici.":
    "Nenhuma conta — solte uma aqui.",
  "Aucun prêt non remboursé disponible.":
    "Nenhum empréstimo em aberto disponível.",
  "Aucune dépense non remboursée disponible.":
    "Nenhuma despesa não reembolsada disponível.",
  "Aucun titre. Ajoute-en un ci-dessous.":
    "Nenhum título. Adicione um abaixo.",
  "Glisser pour réordonner, ou vers une autre carte pour changer de type":
    "Arraste para reordenar, ou para outro cartão para mudar o tipo",
  "Solde initial dans cette monnaie":
    "Saldo inicial nesta moeda",
  "Cours unitaire actuel":
    "Cotação unitária atual",
  "aucun résultat":
    "nenhum resultado",
  "Afficher":
    "Mostrar",
  "Filtrer sur l'année entière":
    "Filtrar pelo ano inteiro",
  "Filtrer sur un mois":
    "Filtrar por um mês",
  "Tout":
    "Tudo",
  "Toutes les périodes, sans borne de date":
    "Todos os períodos, sem limite de data",
  "Enregistré":
    "Salvo",
  "Nouvelle opération":
    "Nova transação",
  "Modifier l'opération":
    "Modificar a transação",
  "Prêts réglés":
    "Empréstimos quitados",
  "Opérations réglées":
    "Transações quitadas",
  "Date (récent → ancien)":
    "Data (mais recente primeiro)",
  "Date (ancien → récent)":
    "Data (mais antiga primeiro)",
  "Montant (décroissant)":
    "Valor (decrescente)",
  "Catégorie (A → Z)":
    "Categoria (A → Z)",
  "Reste à rembourser (décroissant)":
    "Resta a reembolsar (decrescente)",
  "Reste à rembourser (croissant)":
    "Resta a reembolsar (crescente)",
  "Compte source (A → Z)":
    "Conta de origem (A → Z)",
  "Montant (croissant)":
    "Valor (crescente)",
  "Nature (A → Z)":
    "Descrição (A → Z)",
  "Compte (A → Z)":
    "Conta (A → Z)",
  "Projeté":
    "Projetado",
  "coté en":
    "cotado em",
  "réel":
    "real",
  "prévisionnel":
    "previsto",
  "{montant} seront débités des espèces du compte.":
    "{montant} serão debitados do dinheiro da conta.",
  "{montant} seront crédités sur les espèces du compte.":
    "{montant} serão creditados no dinheiro da conta.",
  "virement : compte en face à renseigner":
    "transferência: conta de destino a informar",
  "compte en face à renseigner à l'import":
    "conta de destino a informar na importação",
  "Dépose un libellé ici.":
    "Solte uma descrição aqui.",
  "Aucune correspondance de devise mémorisée (aucun preset ne lit peut-être de colonne de devise).":
    "Nenhuma correspondência de moeda memorizada (talvez nenhuma predefinição leia uma coluna de moeda).",
  "Colonne n°":
    "Coluna nº",
  "Cette propriété est obligatoire : elle ne peut pas être désactivée.":
    "Esta propriedade é obrigatória: não pode ser desativada.",
  "Ne plus lire cette colonne":
    "Deixar de ler esta coluna",
  "Lire cette colonne":
    "Ler esta coluna",
  "Renseigne le numéro de colonne de : {proprietes}.":
    "Informe o número da coluna de: {proprietes}.",
  "Catégorie bancaire":
    "Categoria bancária",
  "Nature / libellé":
    "Descrição / histórico",
  "est":
    "é",
  "n'est pas":
    "não é",
  "contient":
    "contém",
  "ne contient pas":
    "não contém",
  "Si":
    "Se",
  "Cette écriture n'a pas de seconde jambe (virement importé sans compte en face) : supprime-la et recrée le virement avec ses deux comptes.":
    "Este lançamento não tem segunda perna (transferência importada sem conta de destino): exclua-o e crie a transferência de novo com as duas contas.",
  "La seconde écriture de ce virement n'est pas dans la liste affichée : vide les filtres pour la modifier.":
    "O segundo lançamento desta transferência não está na lista exibida: limpe os filtros para modificá-lo.",
  "ET":
    "E",
  "OU":
    "OU",
  "ou":
    "ou",
  "et":
    "e",
  "Import de placements":
    "Importação de investimentos",
  "Importer des opérations":
    "Importar transações",
  "← Retour aux placements":
    "← Voltar aos investimentos",
  "Lit une liste d'opérations exportée depuis un compte de placements : achats, ventes et transferts d'espèces. Rien n'entre en base avant que tu ne valides l'aperçu.":
    "Lê uma lista de transações exportada de uma conta de investimentos: compras, vendas e transferências de dinheiro. Nada entra no banco antes de você validar a pré-visualização.",
  "Aucun compte de placements financiers. Crée-en un depuis la page Comptes en choisissant le type \"Placements financiers\", puis reviens ici.":
    "Nenhuma conta de investimentos. Crie uma na página Contas escolhendo o tipo \"Investimentos\", depois volte aqui.",
  "Format du fichier":
    "Formato do arquivo",
  "Compte de placements de ce preset":
    "Conta de investimentos desta predefinição",
  "— aucun (choisir à chaque fichier) —":
    "— nenhuma (escolher a cada arquivo) —",
  "Quelle colonne du fichier porte quoi. Les numéros sont ceux d'Excel : la première colonne est la n°1. L'œil barré ne lit pas la colonne.":
    "Qual coluna do arquivo traz o quê. Os números são os do Excel: a primeira coluna é a nº 1. O olho riscado não lê a coluna.",
  "Mots-clés de la colonne « Type d'opération »":
    "Palavras-chave da coluna « Tipo de transação »",
  "Transfert interne (espèces)":
    "Transferência interna (dinheiro)",
  "Compte de placements pour ce fichier":
    "Conta de investimentos para este arquivo",
  "Titres qui seront créés":
    "Títulos que serão criados",
  "Transferts déjà connus":
    "Transferências já conhecidas",
  "Achats —":
    "Compras —",
  "Ventes —":
    "Vendas —",
  "Transferts internes —":
    "Transferências internas —",
  "Lignes en erreur —":
    "Linhas com erro —",
  "Valeur":
    "Ativo",
  "ISIN":
    "ISIN",
  "Le relevé ne décrit qu'un côté du mouvement : indique le compte en face. Le sens (émetteur ou récepteur) est déduit du signe du montant.":
    "O extrato descreve apenas um lado do movimento: indique a conta de destino. O sentido (remetente ou destinatário) é deduzido do sinal do valor.",
  "Date de l'opération":
    "Data da transação",
  "Type d'opération":
    "Tipo de transação",
  "Nom de la valeur":
    "Nome do ativo",
  "Code ISIN":
    "Código ISIN",
  "Montant de l'opération":
    "Valor da transação",
  "Transfert interne":
    "Transferência interna",
  "Le nombre de titres achetés ou vendus.\n\nSans objet sur une ligne de transfert d'espèces, qui peut la laisser vide.":
    "O número de títulos comprados ou vendidos.\n\nSem sentido em uma linha de transferência de dinheiro, que pode deixá-la vazia.",
  "Garde le nom de la valeur ou le code ISIN : sans l'un des deux, aucune ligne ne peut dire de quel titre elle parle.":
    "Mantenha o nome do ativo ou o código ISIN: sem um dos dois, nenhuma linha pode dizer de qual título está falando.",
  "Aucun preset. Crée-en un pour commencer.":
    "Nenhuma predefinição. Crie uma para começar.",
  "Aucune colonne choisie : ajoute-en au moins une, sinon plus rien ne distingue deux lignes.":
    "Nenhuma coluna escolhida: adicione pelo menos uma, senão nada distingue duas linhas.",
  "Aucune colonne exclue : toutes les colonnes du fichier sont comparées.":
    "Nenhuma coluna excluída: todas as colunas do arquivo são comparadas.",
  "colonne(s) lue(s)":
    "coluna(s) lida(s)",
  "La plupart des lignes sont illisibles : le délimiteur ou le séparateur décimal ne convient probablement pas à ce fichier.":
    "A maioria das linhas está ilegível: o delimitador ou o separador decimal provavelmente não serve para este arquivo.",
  "ligne(s) au total — fais défiler le tableau pour les voir toutes.":
    "linha(s) no total — role a tabela para vê-las todas.",
  "doublon":
    "duplicata",
  "nouveau":
    "novo",
  "à renseigner":
    "a informar",
  "cours du fichier":
    "cotação do arquivo",
  "compte en face":
    "conta de destino",
  "jour(s) d'écart":
    "dia(s) de diferença",
  "Compte en face (transfert)":
    "Conta de destino (transferência)",
  "— d'après le fichier —":
    "— conforme o arquivo —",
  "— aucun —":
    "— nenhuma —",
  "Appliquer":
    "Aplicar",
  "Supprime ou décoche les lignes sélectionnées pour pouvoir confirmer.":
    "Exclua ou desmarque as linhas selecionadas para poder confirmar.",
  "opération(s) créée(s)":
    "transação(ões) criada(s)",
  "titre(s) créé(s)":
    "título(s) criado(s)",
  "doublon(s) signalé(s)":
    "duplicata(s) sinalizada(s)",
  "ligne(s) non importée(s) :":
    "linha(s) não importada(s):",
  "Aucun import sous ce preset.":
    "Nenhuma importação com esta predefinição.",
  "(sans nom)":
    "(sem nome)",
  "opération(s)":
    "transação(ões)",
  "ignorée(s)":
    "ignorada(s)",
  "doublon(s)":
    "duplicata(s)",
  "Annuler cet import":
    "Cancelar esta importação",
  "import antérieur au suivi des opérations":
    "importação anterior ao acompanhamento das transações",
  "Annuler cet import supprimera les opérations qu'il a créées, y compris celles modifiées depuis. Continuer ?":
    "Cancelar esta importação excluirá as transações que ela criou, inclusive as modificadas desde então. Continuar?",
  "opération(s) supprimée(s)":
    "transação(ões) excluída(s)",
  "Nom du nouveau preset (le nom de ton courtier, par exemple)":
    "Nome da nova predefinição (o nome da sua corretora, por exemplo)",
  "Preset créé":
    "Predefinição criada",
  "Nouveau nom":
    "Novo nome",
  "Supprimer ce preset effacera aussi son historique d'imports et ses lignes de comparaison. Les opérations déjà importées, elles, restent. Continuer ?":
    "Excluir esta predefinição apagará também seu histórico de importações e suas linhas de comparação. As transações já importadas, essas, permanecem. Continuar?",
  "Les doublons détectés sont pré-sélectionnés. Tant qu'il reste des lignes sélectionnées, l'import est bloqué : supprime-les, ou décoche-les pour les importer quand même.":
    "As duplicatas detectadas já vêm pré-selecionadas. Enquanto houver linhas selecionadas, a importação fica bloqueada: exclua-as, ou desmarque-as para importá-las mesmo assim.",
  "Problème":
    "Problema",
  "Imports précédents":
    "Importações anteriores",
  "Fais glisser cet en-tête pour déplacer la colonne":
    "Arraste este cabeçalho para mover a coluna",
  "Ordre des colonnes enregistré":
    "Ordem das colunas salva",
  "Les mots que ton courtier emploie pour dire achat, vente ou mouvement d'espèces. Ajoute-les un par un avec « + » ou Entrée ; majuscules, accents et espaces sont ignorés. Une liste vide retombe sur les mots par défaut, un libellé inconnu met la ligne en erreur.":
    "As palavras que a sua corretora usa para dizer compra, venda ou movimento de dinheiro. Adicione-as uma a uma com « + » ou Enter; maiúsculas, acentos e espaços são ignorados. Uma lista vazia volta às palavras padrão, uma descrição desconhecida coloca a linha em erro.",
  "Ajouter ce mot-clé":
    "Adicionar esta palavra-chave",
  " (hors frais)":
    " (sem tarifas)",
  "Cette colonne n'existe pas dans le fichier : déplace son en-tête sur une colonne réelle.":
    "Esta coluna não existe no arquivo: arraste o cabeçalho dela para uma coluna real.",
  "Les colonnes ont changé depuis la dernière lecture. Relire le fichier pour voir ce que l'import donnera, puis « Enregistrer la configuration » pour garder cet ordre dans le preset.":
    "As colunas mudaram desde a última leitura. Releia o arquivo para ver o que a importação dará, depois use « Salvar a configuração » para manter esta ordem na predefinição.",
  "Glisse cet en-tête sur un autre pour échanger les deux colonnes":
    "Arraste este cabeçalho sobre outro para trocar as duas colunas",
  "Relire le fichier avec la configuration actuelle":
    "Reler o arquivo com a configuração atual",
  "Les colonnes ont changé : relire le fichier pour voir ce que l'import donnera.":
    "As colunas mudaram: releia o arquivo para ver o que a importação dará.",
  "Aucun fichier chargé à relire.":
    "Nenhum arquivo carregado para reler.",
  "Retirer":
    "Remover",
  "Mots-clés":
    "Palavras-chave",
  "Aucun mot-clé : la condition ne compare rien.":
    "Nenhuma palavra-chave: a condição não compara nada.",
  "ex. PRET":
    "ex. EMPRESTIMO",
  "Aucun mot-clé — les mots par défaut s'appliquent.":
    "Nenhuma palavra-chave — as palavras padrão se aplicam.",
  "Rien à supprimer.":
    "Nada a remover.",
  "Ce mot-clé est déjà dans la liste.":
    "Esta palavra-chave já está na lista.",
  "« {mot} » est déjà un mot-clé de « {type} ».":
    "« {mot} » já é uma palavra-chave de « {type} ».",
  "Règles de type d'opération":
    "Regras de tipo de transação",
  "mots-clés du preset":
    "palavras-chave da predefinição",
  "ex. Achats au comptant":
    "ex. Compras à vista",
  "La ligne décrit":
    "A linha descreve",
  "Un achat de titres":
    "Uma compra de títulos",
  "Une vente de titres":
    "Uma venda de títulos",
  "Un transfert interne (espèces)":
    "Uma transferência interna (dinheiro)",
  "Aucune règle : le type de chaque ligne est reconnu par les mots-clés du preset.":
    "Nenhuma regra: o tipo de cada linha é reconhecido pelas palavras-chave da predefinição.",
  "Glisse pour changer l'ordre":
    "Arraste para mudar a ordem",
  "Combiner avec":
    "Combinar com",
  "Supprimer le groupe":
    "Excluir o grupo",
  "Ajouter une condition":
    "Adicionar uma condição",
  "Modifier la règle":
    "Modificar a regra",
  "+ Nouveau projet":
    "+ Novo projeto",
  "Nouveau projet":
    "Novo projeto",
  "Modifier le projet":
    "Modificar o projeto",
  "ex. Vacances Italie":
    "ex. Férias na Itália",
  "ex. du 3 au 17 août, Rome et Naples":
    "ex. de 3 a 17 de agosto, Roma e Nápoles",
  "← Retour aux projets":
    "← Voltar aos projetos",
  "+ Ajouter des opérations":
    "+ Adicionar transações",
  "Ajouter des opérations":
    "Adicionar transações",
  "Ajouter une opération ici ne la retire d'aucun autre projet, et ne change ni sa catégorie ni son compte.":
    "Adicionar uma transação aqui não a tira de nenhum outro projeto, e não muda nem a categoria nem a conta dela.",
  "Montant min":
    "Valor mín.",
  "Montant max":
    "Valor máx.",
  "ex. 50":
    "ex. 50",
  "ex. 500":
    "ex. 500",
  "Nature contient":
    "Descrição contém",
  "— tous —":
    "— todos —",
  "ex. hôtel":
    "ex. hotel",
  "Ajouter au projet (":
    "Adicionar ao projeto (",
  "Opérations du projet —":
    "Transações do projeto —",
  "Aucun projet. Crée-en un, puis verses-y les opérations d'un même voyage ou d'un même événement.":
    "Nenhum projeto. Crie um, depois coloque nele as transações de uma mesma viagem ou de um mesmo evento.",
  "Aucune opération.":
    "Nenhuma transação.",
  "Aucune opération dans ce projet.":
    "Nenhuma transação neste projeto.",
  "Projet créé":
    "Projeto criado",
  "Projet modifié":
    "Projeto modificado",
  "Projet supprimé. Aucune opération n'a été supprimée.":
    "Projeto excluído. Nenhuma transação foi excluída.",
  "Opération retirée du projet (elle reste en base).":
    "Transação removida do projeto (ela continua no banco).",
  "Donne un nom au projet.":
    "Dê um nome ao projeto.",
  "{n} opération(s) proposée(s). Celles déjà dans ce projet ne sont pas listées.":
    "{n} transação(ões) sugerida(s). As que já estão neste projeto não são listadas.",
  "{n} opération(s) ajoutée(s) au projet.":
    "{n} transação(ões) adicionada(s) ao projeto.",
  "Épargne":
    "Poupança",
  "Taux enregistré":
    "Taxa salva",
  "Versements":
    "Pagamentos",
  "Intérêts":
    "Juros",
  "Mouvement":
    "Movimento",
  "Chaque ligne jugée identique (hors colonnes exclues, cf. Configuration du fichier) à une ligne déjà importée sous ce preset est affichée ici, suivie en lecture seule de celle qu'elle double. Elles sont pré-sélectionnées pour être supprimées d'un clic — décoche-en une pour l'importer quand même (deux achats identiques le même jour sont un doublon détecté légitime).":
    "Cada linha considerada idêntica (colunas excluídas à parte, veja Configuração do arquivo) a uma linha já importada com esta predefinição aparece aqui, seguida em somente leitura da que ela duplica. Elas vêm pré-selecionadas para serem excluídas com um clique — desmarque uma para importá-la mesmo assim (duas compras idênticas no mesmo dia são uma duplicata detectada legítima).",
  "Transferts déjà connus —":
    "Transferências já conhecidas —",
  "Ressemble à :":
    "Parece com:",
  "déjà en base":
    "já no banco",
  "virement déjà enregistré":
    "transferência já registrada",
  "du même fichier":
    "do mesmo arquivo",
  "le même jour":
    "no mesmo dia",
  "Une ligne de compte-titres n'a pas de catégorie : un mouvement de titres n'en porte pas. Un transfert, lui, touche deux comptes et le relevé n'en nomme qu'un — la règle peut donc désigner le second.":
    "Uma linha de conta de títulos não tem categoria: um movimento de títulos não carrega nenhuma. Uma transferência, porém, toca duas contas e o extrato nomeia apenas uma — a regra pode então designar a segunda.",
  "L'autre compte : celui d'où vient l'argent versé, ou celui où va l'argent retiré. Le sens se déduit du signe du montant. Sans lui, la ligne est à compléter à la main dans l'aperçu.":
    "A outra conta: aquela de onde vem o dinheiro depositado, ou para onde vai o dinheiro retirado. O sentido é deduzido do sinal do valor. Sem ela, a linha precisa ser completada à mão na pré-visualização.",
  "en face":
    "de destino",
  "Nom du courtier :":
    "Nome da corretora:",
  "renommé":
    "renomeado",
  "Changer le nom affiché (le nom du courtier ne bouge pas)":
    "Mudar o nome exibido (o nome da corretora não muda)",
  "Nom à afficher pour « {nom} » (laisse vide pour revenir au nom du courtier)":
    "Nome a exibir para « {nom} » (deixe vazio para voltar ao nome da corretora)",
  "Titre renommé":
    "Título renomeado",
  "Nom du courtier rétabli":
    "Nome da corretora restaurado",
  "Afficher le lien de cotation":
    "Mostrar o link de cotação",
  "Cours relu en ligne":
    "Cotação relida online",
  "Le fichier contient":
    "O arquivo contém",
  "Une liste d'opérations rejoue l'histoire du compte : une ligne par achat, vente ou transfert, chacune datée. Une photographie dit ce que tu détiens aujourd'hui : une ligne par titre, sa quantité, son prix de revient. La photographie évite de réimporter dix ans de mouvements.":
    "Uma lista de transações reproduz a história da conta: uma linha por compra, venda ou transferência, cada uma datada. Uma posição diz o que você detém hoje: uma linha por título, sua quantidade, seu preço médio. A posição evita reimportar dez anos de movimentos.",
  "Une liste d'opérations (achats, ventes, transferts)":
    "Uma lista de transações (compras, vendas, transferências)",
  "Une photographie du compte (titres détenus)":
    "Uma posição da conta (títulos em carteira)",
  "Date de la photographie":
    "Data da posição",
  "Le jour où la photographie a été prise : c'est de cette date que l'app te considère détenteur de ces titres. Aujourd'hui par défaut.":
    "O dia em que a posição foi tirada: é a partir dessa data que o app considera você detentor desses títulos. Hoje por padrão.",
  "Titres détenus —":
    "Títulos em carteira —",
  "Montant investi":
    "Valor investido",
  "Cours déduit":
    "Cotação deduzida",
  "Quantité détenue":
    "Quantidade detida",
  "Prix de revient unitaire":
    "Preço médio unitário",
  "Valorisation actuelle":
    "Valorização atual",
  "déjà":
    "já",
  "Ce compte détient déjà ce titre : importer cette ligne s'ajoutera à ce qui s'y trouve.":
    "Esta conta já detém este título: importar esta linha se somará ao que já existe.",
  "Colonnes remises à celles de ce type de fichier. Enregistre pour confirmer.":
    "Colunas redefinidas para as deste tipo de arquivo. Salve para confirmar.",
  "Ce fichier est-il une PHOTOGRAPHIE du compte (une ligne par titre détenu) ?\n\nOK : photographie.\nAnnuler : liste d'opérations (achats, ventes, transferts).":
    "Este arquivo é uma POSIÇÃO da conta (uma linha por título em carteira)?\n\nOK: posição.\nCancelar: lista de transações (compras, vendas, transferências).",
  "{n} mois":
    "{n} meses",
  "1 mois":
    "1 mês",
  "La touche permettant de geler l'infobulle sur les graphiques. Pour la changer, clique sur le champ et saisis la nouvelle touche ou combinaison de touches":
    "A tecla que congela a dica nos gráficos. Para mudá-la, clique no campo e pressione a nova tecla ou combinação de teclas",
  "Permet de changer la monnaie d'affichage par défaut : celle qui s'affiche en premier au lancement de l'app ou d'une page":
    "Muda a moeda de exibição padrão: a que aparece primeiro ao abrir o app ou uma página",
  "Monnaie d'affichage par défaut":
    "Moeda de exibição padrão",
  "Aucune (la première)":
    "Nenhuma (a primeira)",
  "Réglage non enregistré.":
    "Ajuste não salvo.",
  "La répartition de tes dépenses rapportées à ton budget de la période.":
    "Como suas despesas se distribuem em relação ao seu orçamento do período.",
  "Ce qu'on te doit - Ce que tu dois.":
    "O que devem a você - o que você deve.",
  "Les entrées d'argent - prévisionnelles incluses - attribuées à la période (différent de ce qui rentre sur ton compte durant la période). Les entrées amorties sont comptées au prorata, et les dépenses remboursables ne comptent que pour la part non-remboursable.":
    "As entradas de dinheiro - previstas incluídas - atribuídas ao período (diferente do que entra na sua conta durante o período). As entradas diluídas são contadas proporcionalmente, e as despesas reembolsáveis só contam pela parte não reembolsável.",
  "Les sorties d'argent - prévisionnelles incluses - attribuées à la période (différent de ce qui sort de ton compte durant la période). Les dépenses amorties sont comptées au prorata. Les prêts ne comptent que pour la partie à rembourser.":
    "As saídas de dinheiro - previstas incluídas - atribuídas ao período (diferente do que sai da sua conta durante o período). As despesas diluídas são contadas proporcionalmente. Os empréstimos só contam pela parte a reembolsar.",
  "La différence des deux KPIs différents.":
    "A diferença entre os dois KPIs diferentes.",
  "La variation de ce que tu possèdes sur le mois : un calcul brut en fonction de la date et du montant.":
    "A variação do que você possui no mês: um cálculo bruto em função da data e do valor.",
  "Pour les opérations à venir qui n'ont pas encore eu lieu. Elles comptent pour ton solde projeté et dans les graphiques du dashboard - de manière distincte.":
    "Para as transações futuras que ainda não aconteceram. Elas contam para o seu saldo projetado e nos gráficos do painel - de forma distinta.",
  "La répartition des avoirs en fonction du type de comptes - prends en compte la valorisation des titres possédés.":
    "A distribuição dos ativos conforme o tipo de conta - leva em conta a valorização dos títulos que você possui.",
  "Montant brut, sans le signe. Ne rien mettre n'impose pas de borne.":
    "Valor bruto, sem o sinal. Deixar vazio não impõe limite.",
  "Les frais sur ton opération. Ils apparaissent séparément pour pouvoir les distinguer, mais c'est bien le montant + les frais (ou - les frais) qui sont utilisés pour les calculs.":
    "As tarifas da sua transação. Elas aparecem separadamente para poder distingui-las, mas é o valor + as tarifas (ou - as tarifas) que é usado nos cálculos.",
  "Utile pour les virements internes entre devises différentes. Elle permet à l'app de comprendre si elle doit soustraire ou additioner les frais - et où.":
    "Útil para transferências internas entre moedas diferentes. Permite ao app entender se deve subtrair ou somar as tarifas - e onde.",
  "Pour répartir le montant d'une opération en plusieurs catégories.":
    "Para repartir o valor de uma transação entre várias categorias.",
  "Permet d'amortir la dépense sur plusieurs mois, pour avoir une meilleure vue de tes dépenses. N'affecte pas le solde de ton compte et ne change pas la date de l'opération.":
    "Permite diluir a despesa ao longo de vários meses, para ter uma visão melhor das suas despesas. Não afeta o saldo da sua conta e não muda a data da transação.",
  "Le mode d'emploi de l'application. Il est assez dense, mais n'a pas vocation à être lu d'un coup. Il s'agit pluôt d'un guide à consulter si tu te poses des questions.":
    "O manual de uso do aplicativo. É bastante denso e não foi feito para ser lido de uma só vez. Pense nele como um guia para consultar quando surgirem dúvidas.",
  "C'est la première brique pour catégoriser tes opérations : affecter une opération à un compte impactera son solde, et pas celui des autres.":
    "É o primeiro tijolo para categorizar suas transações: atribuir uma transação a uma conta afetará o saldo dela, e não o das outras.",
  "Une ligne : une date, un libellé, un montant, un compte. C'est la base sur laquelle repose le reste de l'application.":
    "Uma linha: uma data, uma descrição, um valor, uma conta. É a base sobre a qual o resto do aplicativo se apoia.",
  "C'est la seconde brique pour catégoriser une opération, qui vient avec des valeurs par défaut (modifiables et supprimables) : alimentation, transports, loisirs. C'est avec elles que les graphiques du dashboard se construisent.":
    "É o segundo tijolo para categorizar uma transação, e vem com valores padrão (editáveis e excluíveis): alimentação, transporte, lazer. É com elas que os gráficos do painel são construídos.",
  "L'application permet de prendre en compte plusieurs devises avec l'extension « Monnaies », pour ne pas mélanger ce qui ne devrait pas l'être.":
    "O aplicativo permite levar em conta várias moedas com a extensão « Monnaies », para não misturar o que não deve ser misturado.",
  "Crée ton ou tes comptes (dans Paramètres → Comptes /Paramètres/Comptes), en choissisant leur type (Courant, d'épargne ou de placements) et leur solde de départ.":
    "Crie sua(s) conta(s) (em Ajustes → Contas /Ajustes/Contas), escolhendo o tipo (corrente, poupança ou investimentos) e o saldo inicial.",
  "Réorganise tes catégories, dans Paramètres → Catégories /Paramètres/Catégories. Tu peux librement en créer, supprimer et modifier, dont les 4 de base.":
    "Reorganize suas categorias, em Ajustes → Categorias /Ajustes/Categorias. Você pode criá-las, excluí-las e modificá-las livremente, inclusive as 4 padrão.",
  "Créer tes opérations : à la main dans la page Opérations /Opérations, ou par un import de relevé (cf. Importer un relevé /Importer un relevé)":
    "Crie suas transações: à mão na página Transações /Transações, ou por uma importação de extrato (veja Importar um extrato /Importar um extrato)",
  "Ensuite, direction le dashboard ! /- En haut, une vue globale de tes avoirs. /- Au milieu, des cartes qui décrivent l'évolution de ton compte sur le mois ou l'année. /- En bas, deux graphiques te permettant de comprendre ta répartition. // Et enfin, un champ libre de notes (qui s'enregistre automatiquement).":
    "Em seguida, vá ao painel! /- Em cima, uma visão global dos seus ativos. /- No meio, cartões que descrevem a evolução da sua conta no mês ou no ano. /- Embaixo, dois gráficos que ajudam você a entender a sua distribuição. // E por fim, um campo livre de notas (que salva automaticamente).",
  "Toutes tes données vivent dans un fichier, dont tu dois choisir l'emplacement au premier lancement. Tu peux le déplacer via Paramètres → Base de données /Paramètres/Base de données. Aucune copie n'est faite et rien ne sort de ton PC : fais donc attention à ne pas le supprimer par erreur.":
    "Todos os seus dados vivem em um arquivo, cujo local você deve escolher na primeira abertura. Você pode movê-lo em Ajustes → Banco de dados /Ajustes/Banco de dados. Nenhuma cópia é feita e nada sai do seu PC: portanto tome cuidado para não apagá-lo por engano.",
  "Le dashboard répond à deux questions différentes : qu'est-ce que tu as aujourd'hui (cartes en haut) et comment ce que tu as a évolué (cartes en-dessous) sur la période choisie.":
    "O painel responde a duas perguntas diferentes: o que você tem hoje (cartões de cima) e como o que você tem evoluiu (cartões de baixo) no período escolhido.",
  "Le total de tes comptes courants. Le chiffre en plus est le prévisionnel, il prend en compte les opérations prévisionelles (cf. Les types d'opérations /Les types d'opérations).":
    "O total das suas contas correntes. O número a mais é o previsto, que leva em conta as transações previstas (veja Os tipos de transação /Os tipos de transação).",
  "Ce KPI regroupe tout ce que tu possèdes : comptes courants, épargne, et la valeur de tes titres côtés si l'extension « Placements financiers » tourne.":
    "Este KPI reúne tudo o que você possui: contas correntes, poupança e o valor dos seus títulos negociados, se a extensão « Placements financiers » estiver ativa.",
  "Deux KPIs pour deux manières de calculer des variations sur le mois : l'une dit ce que le mois COÛTE - les dépenses que tu as attribuées à ce mois - et l'autre ce qui est PASSÉ sur ton compte sur ce mois. /- Par exemple, tu peux payer pour un abonnement annuel et vouloir le faire compter sur chaque mois au lieu d'un seul dans l'année (c'est la fonctionnalité d'amortissement /Les types d'opérations). /- Tu peux aussi avoir une dépense à faire rembourser (en partie ou en totalité) : le premier KPI prendra en compte ce que tu as dépense - ce qu'on te doît, l'autre fera abstraction de cette deuxième donnée. // Quand elles diffèrent, un bouton apparaît et te permet de voir plus en détails.":
    "Dois KPIs para duas maneiras de calcular variações no mês: um diz o que o mês CUSTA - as despesas que você atribuiu a este mês - e o outro o que PASSOU na sua conta neste mês. /- Por exemplo, você pode pagar uma assinatura anual e querer que ela conte em cada mês, em vez de um só no ano (é o recurso de diluição /Os tipos de transação). /- Você também pode ter uma despesa a ser reembolsada (em parte ou totalmente): o primeiro KPI levará em conta o que você gastou - o que lhe devem, o outro ignorará esse segundo dado. // Quando eles diferem, aparece um botão que permite ver mais detalhes.",
  "Les deux graphes montrent la répartition de tes dépenses en fonction de la catégorie. Tu pilotes l'affichage avec la période du sélecteur et avec le filtre « Catégories ». Survoler une barre, une tranche ou une ligne de légende ouvre une infobulle avec plus de détails : /- Le total de la catégorie /- Le poids en pourcentage de celle-ci /- Ton top 3 dépenses (agrégées selon le nom : si tu fais 5 fois des courses au même endroit, tu verras une ligne avec le total et un (5)). /- Enfin, tes objectifs de budget s'y affichent si tu as activé l'extension.":
    "Os dois gráficos mostram a distribuição das suas despesas por categoria. Você controla a exibição com o período do seletor e com o filtro « Categorias ». Passar o mouse sobre uma barra, uma fatia ou uma linha da legenda abre uma dica com mais detalhes: /- O total da categoria /- O peso dela em porcentagem /- Seu top 3 de despesas (agregadas pelo nome: se você faz compras 5 vezes no mesmo lugar, verá uma linha com o total e um (5)). /- Por fim, suas metas de orçamento aparecem ali se você ativou a extensão.",
  "L'histogramme affiche le total par catégorie ! Si tu as l'extension « Budget », la barre rouge qui apparaît est le budget que tu t'es fixé.":
    "O histograma mostra o total por categoria! Se você tem a extensão « Budget », a barra vermelha que aparece é o orçamento que você definiu.",
  "Le camembert montre la part de chaque catégorie. / -En vue « État actuel », chaque tranche est rapportée au total dépensé (le total fait donc 100%). /- En vue « Budget », elles sont rapportées au budget du mois : l'anneau reste ouvert sur ce qui n'a pas été dépensé.":
    "O gráfico de pizza mostra a participação de cada categoria. / -Na visão « Estado atual », cada fatia é relacionada ao total gasto (o total faz portanto 100%). /- Na visão « Orçamento », elas são relacionadas ao orçamento do mês: o anel fica aberto no que não foi gasto.",
  "La légende sous les deux est commune aux deux graphiques : l'infobulle affiche le bouton « Voir toutes les dépenses » qui t'emmène à la liste des opérations de cette catégorie.":
    "A legenda sob os dois é comum aos dois gráficos: a dica mostra o botão « Ver todas as despesas » que leva à lista das transações dessa categoria.",
  "La flèche sous la rangée des mois déplie les semaines : l'histogramme devient celui de la semaine choisie, et « Moyenne » te montre une vue moyennée sur le mois (au prorata en fonction du nombre de jours écoulés). Les cartes ne sont pas affectées.":
    "A seta sob a linha dos meses abre as semanas: o histograma passa a ser o da semana escolhida, e « Média » mostra uma visão mediada sobre o mês (proporcional ao número de dias decorridos). Os cartões não são afetados.",
  "Le type d'une opération te permet de dicter comment elle agit. Deux types sont disponibles de base, les opérations classiques (entrées et sorties d'argent) et les virements internes (entre deux comptes que tu possèdes). Les autres sont activables et utilisables grâce à des extensions.":
    "O tipo de uma transação permite ditar como ela age. Dois tipos estão disponíveis de início: as transações padrão (entradas e saídas de dinheiro) e as transferências internas (entre duas contas que você possui). Os outros podem ser ativados e usados por meio de extensões.",
  "Le type d'opération par défaut et le plus courant : des courses, un paiement, un salaire, etc... C'est le seul type que tu peux découper en plusieurs catégories (plus de détails en bas de page).":
    "O tipo de transação padrão e o mais comum: compras, um pagamento, um salário, etc. É o único tipo que você pode dividir entre várias categorias (mais detalhes no fim da página).",
  "Les virements internes ne font pas bouger combien tu possèdes. Ils ont leur type à part, et ne rentrent pas dans les calculs de tes KPIs (à l'exception des virements internes entre deux monnaies différentes).":
    "As transferências internas não mudam quanto você possui. Elas têm seu próprio tipo e não entram nos cálculos dos seus KPIs (exceto as transferências internas entre duas moedas diferentes).",
  "Si tu as avancé de l'argent ou qu'une de tes dépenses est remboursable, ce type est fait pour ton opération. Il te permet de /- ne compter que combien tu as réellement dépensé dans tes KPIs et les graphiques /- renseigner un montant dû /- suivre combien on te doit // Quand un remboursement est effectué (en partie ou totalement), le type Remboursement reçu te permet de relier l'opération de remboursement à la dépense remboursable.":
    "Se você adiantou dinheiro ou se uma das suas despesas é reembolsável, este tipo é feito para a sua transação. Ele permite /- contar nos seus KPIs e gráficos apenas quanto você realmente gastou /- informar um valor devido /- acompanhar quanto lhe devem // Quando um reembolso é feito (em parte ou totalmente), o tipo Reembolso recebido permite vincular a transação de reembolso à despesa reembolsável.",
  "Ce type est similaire au précédent, mais dans la situation inverse. Ici, seul les intérêts du montant prêté (s'il y en a) rentrent dans le compte des dépenses.":
    "Este tipo é parecido com o anterior, mas na situação inversa. Aqui, apenas os juros do valor emprestado (se houver) entram na conta das despesas.",
  "Deux possibilités pour une opération, réelle ou prévisionnelle :/- les dépenses réelles (la plupart des opérations) sont celles qui ont eu lieu /- les dépenses prévisionnelles sont celles que tu anticipes. A l'import de l'opération en question, l'app le détecte et te propose de remplacer l'opération prévisionnelle.":
    "Duas possibilidades para uma transação, real ou prevista: /- as despesas reais (a maioria das transações) são as que aconteceram /- as despesas previstas são as que você antecipa. Na importação da transação em questão, o app detecta e propõe substituir a transação prevista.",
  "L'import, c'est la manière la plus simple de mettre l'app à jour sur ton budget. Tu peux créer des preset d'imports et des règles /Les extensions/Règles de catégorisation pour configurer une fois ton système d'importation. Les fois d'après, il ne suffira que de quelques clics pour importer.":
    "Importar é a maneira mais simples de atualizar o app com o seu orçamento. Você pode criar predefinições de importação e regras /As extensões/Regras de categorização para configurar uma vez o seu sistema de importação. Das próximas vezes, bastarão alguns cliques para importar.",
  "Un relevé d'exemple au format CSV est disponible te permettre de visualiser. Il contient deux lignes de titre (à ne pas lire) trois colonnes inutiles pour l'app.":
    "Um extrato de exemplo em formato CSV está disponível para você visualizar. Ele contém duas linhas de título (que não devem ser lidas) e três colunas inúteis para o app.",
  "Choisis ou crée le PRESET qui correspond à ton fichier, et sélectionne de quel compte il s'agit.":
    "Escolha ou crie a PREDEFINIÇÃO que corresponde ao seu arquivo e selecione de qual conta se trata.",
  "Dépose le fichier. L'application le lit et affiche comment elle le lit actuellement.":
    "Solte o arquivo. O aplicativo o lê e mostra como o lê atualmente.",
  "Remplis les correspondances entre catégories, monnaies ou banques de ton relevé et ceux de l'app. L'app les garde en mémoire pour que tu n'aies pas à les renseigner à nouveau.":
    "Preencha as correspondências entre as categorias, moedas ou bancos do seu extrato e os do app. O app as guarda na memória para que você não precise informá-las de novo.",
  "Confirmer te permet de finaliser ! Si tu souhaites revenir en arrière, tu peux annuler l'import : tout revient alors précisément à l'état précédent.":
    "Confirmar permite finalizar! Se quiser voltar atrás, você pode cancelar a importação: tudo volta então exatamente ao estado anterior.",
  "L'application est par défaut minimaliste. Une fois familiarisé, choisis les extensions qui t'intéressent et te sont utiles à ta guise.":
    "O aplicativo é minimalista por padrão. Depois de se familiarizar, escolha as extensões que interessam a você e que lhe são úteis, como preferir.",
  "Éteindre une extension ne supprime AUCUNE donnée : seul l'affichage disparaît.":
    "Desligar uma extensão não exclui NENHUM dado: apenas a exibição desaparece.",
  "« Comparer avec » te permet de comparer deux périodes de même durée.":
    "« Comparar com » permite comparar dois períodos de mesma duração.",
  "Le budget de chaque mois, il reprend la valeur du dernier mois par défaut. Il relie les objectifs par catégorie en pourcentage et en valeur. ":
    "O orçamento de cada mês; por padrão ele retoma o valor do último mês. Ele relaciona as metas por categoria em porcentagem e em valor. ",
  "Mois par mois et monnaie par monnaie. Hérite par défaut des valeurs du mois précédent.":
    "Mês a mês e moeda por moeda. Herda por padrão os valores do mês anterior.",
  "La différence entre ce qui entre et ce qui sort de tes comptes d'épargne ou de placements. Un bon indicateur à suivre si tu veux mettre de l'argent de côté régulièrement.":
    "A diferença entre o que entra e o que sai das suas contas poupança ou de investimentos. Um bom indicador para acompanhar se você quer guardar dinheiro regularmente.",
  "Le matelas de sécurité que tu gardes sur tes comptes d'épargne - les comptes de placements ne rentrent pas dans ce scope.":
    "A reserva de segurança que você mantém nas suas contas poupança - as contas de investimentos não entram nesse escopo.",
  "Les dépenses que tu n'avais prévues : une vue globale te permet de mieux comprendre comment elles pèsent dans ton budget.":
    "As despesas que você não tinha previsto: uma visão global permite entender melhor como elas pesam no seu orçamento.",
  "Une étiquette lue par l'extension budget. Elle te permet d'avoir une vue globale de tes dépenses liées à des imprévus.":
    "Um rótulo lido pela extensão de orçamento. Ele dá a você uma visão global das suas despesas ligadas a imprevistos.",
  "Ces lignes du relevé correspondent à des dépenses que tu avais écrites d'avance, en prévisionnel. Plutôt que d'ajouter une opération de plus à côté de la prévision, l'import va REMPLACER la prévision par la vraie ligne : même opération, désormais réelle, avec la date et le montant du relevé. Elle garde tout ce qui lui était rattaché — son projet, son profil de remboursement, sa récurrence. Coché, le remplacement a lieu ; décoché, la ligne s'importe comme une autre et la dépense prévue reste telle quelle. Vérifie la colonne de droite avant de confirmer : c'est elle qui dit ce qui sera écrasé. Et si tu te trompes, annuler l'import rend chaque prévision à son état d'origine.":
    "Estas linhas do extrato correspondem a despesas que você tinha escrito antecipadamente, como previstas. Em vez de adicionar mais uma transação ao lado da previsão, a importação vai SUBSTITUIR a previsão pela linha real: mesma transação, agora real, com a data e o valor do extrato. Ela mantém tudo o que estava vinculado a ela — seu projeto, seu perfil de reembolso, sua recorrência. Marcada, a substituição acontece; desmarcada, a linha é importada como outra qualquer e a despesa prevista permanece como está. Confira a coluna da direita antes de confirmar: é ela que diz o que será sobrescrito. E se você se enganar, cancelar a importação devolve cada previsão ao seu estado original.",
  "Permet l'amélioration de la détection d'une dépense prévisionnelle renseignée dans l'app lors de son importation. L'import te proposera alors de valider la substitution.":
    "Melhora a detecção de uma despesa prevista registrada no app no momento da sua importação. A importação propõe então confirmar a substituição.",
  "Permet de ne pas confondre des dépenses de même montant, compte et date mais dont le libellé est différent.":
    "Evita confundir despesas de mesmo valor, conta e data mas de descrição diferente.",
  "Combien on te doit sur une dépense remboursable, combien tu dois sur un prêt.":
    "Quanto devem a você em uma despesa reembolsável, quanto você deve em um empréstimo.",
  "Chaque monnaie du compte garde son propre solde, non mélangé aux autres.":
    "Cada moeda da conta mantém o próprio saldo, sem se misturar com as outras.",
  "Les dépenses se rangent dans ces catégories. Les réordonner change l'ordre d'apparition sur le dashboard. Eteindre une catégorie agit comme si elle n'existait plus à partir de l'extinction, tout en la conservant comme la catégorie des dépenses à laquelle elle est attribuée.":
    "As despesas são organizadas nestas categorias. Reordená-las muda a ordem de aparição no painel. Desligar uma categoria age como se ela não existisse mais a partir do desligamento, mantendo-a como a categoria das despesas às quais está atribuída.",
  "Te permet de marquer des catégories comme étant des entrées d'argent. Elles n'apparaissent pas sur l'histogramme et ne portent pas de budget.":
    "Permite marcar categorias como entradas de dinheiro. Elas não aparecem no histograma e não carregam orçamento.",
  "Les correspondances - catégories, comptes bancaires, monnaies - que l'app a mémorisé de tes imports":
    "As correspondências - categorias, contas bancárias, moedas - que o app memorizou das suas importações",
  "Le libellé de ton relevé, suivi du compte lié au preset d'importation. Glisse-le vers une autre catégorie pour modifier la correspondance.":
    "A descrição do seu extrato, seguida da conta ligada à predefinição de importação. Arraste-a para outra categoria para modificar a correspondência.",
  "Les noms de compte lus dans tes relevés et le comptes de l'app en face.":
    "Os nomes de conta lidos nos seus extratos e a conta do app correspondente.",
  "Les libellés de devise de tes relevés (« EUR »), et la monnaie de l'app en face.":
    "Os rótulos de moeda dos seus extratos (« EUR »), e a moeda do app correspondente.",
  "Comment l'app doit comprendre ton fichier d'opérations.":
    "Como o app deve entender o seu arquivo de transações.",
  "Toutes les lignes du fichier iront sur ce compte. Laisse « aucun » si le fichier comporte une colonne comptes.":
    "Todas as linhas do arquivo irão para esta conta. Deixe « nenhuma » se o arquivo tiver uma coluna de contas.",
  "Quelle colonne de ton fichier porte quelle information. Date, Nature et Montant sont obligatoires.":
    "Qual coluna do seu arquivo traz qual informação. Data, Descrição e Valor são obrigatórios.",
  "Clique sur l'œil pour indiquer à l'app de lire ou d'ignorer une information.":
    "Clique no olho para dizer ao app que leia ou ignore uma informação.",
  "Pour les fichiers nécessitant un paramétrage plus complexe.":
    "Para arquivos que exigem uma configuração mais complexa.",
  "L'application lit le fichier et essaie d'attribuer chaque colonne à une ou plusieurs potentielles propriétés. Ensuite, à toi de trancher. Rien n'est enregistré sur ton preset tant que tu n'utilises pas le bouton d'enregistrement ou d'actualisation.":
    "O aplicativo lê o arquivo e tenta atribuir cada coluna a uma ou mais propriedades possíveis. Depois, cabe a você decidir. Nada é salvo na sua predefinição enquanto você não usar o botão de salvar ou de atualizar.",
  "Appliquer met à jour les colonnes, sans enregistrer le preset. Attention : si tu appuies sur Enregistrer le preset, ton ancien preset sera remplacé par la configuration actuelle.":
    "Aplicar atualiza as colunas, sem salvar a predefinição. Atenção: se você pressionar Salvar a predefinição, sua predefinição antiga será substituída pela configuração atual.",
  "La plupart des lignes sont illisibles, tu peux utiliser la détectection automatique de colonnes pour t'aider à régler ce souci.":
    "A maioria das linhas está ilegível; você pode usar a detecção automática de colunas para ajudar a resolver isso.",
  "Les colonnes lues sont colorées et portent l'information que l'app en tire en en-tête. Deux façons de modifier : glisser un en-tête sur un autre pour échanger les deux ou saisir les numéros dans « Configuration du fichier » au-dessus.":
    "As colunas lidas são coloridas e trazem no cabeçalho a informação que o app extrai delas. Duas formas de modificar: arrastar um cabeçalho sobre outro para trocar os dois, ou digitar os números em « Configuração do arquivo » acima.",
  "Les nouveaux libellés apparaîtront ici, pour que tu renseignes vers quelle catégorie de l'app ils pointent. Une fois fait, confirme en cochant la case.":
    "Os novos rótulos aparecerão aqui, para que você informe para qual categoria do app eles apontam. Feito isso, confirme marcando a caixa.",
  "Les doublons repérés sont déjà cochés pour permettre une suppression rapide. Pour déverrouiller l'import, supprime-les ou décoche-les si tu veux tout de même les importer.":
    "As duplicatas identificadas já vêm marcadas para permitir uma exclusão rápida. Para desbloquear a importação, exclua-as ou desmarque-as se quiser importá-las mesmo assim.",
  "Une détection de doublons pour les virements internes : les opérations ici ne sont pas rejetés par défaut, mais l'app te les signale pour éviter d'importer des opérations en double.":
    "Uma detecção de duplicatas para as transferências internas: as transações aqui não são recusadas por padrão, mas o app as sinaliza para evitar importar transações em duplicidade.",
  "Ces lignes sont identiques à des lignes déjà importées, sur la base des critères que tu as défini pour le preset. Tu peux les importer en les décochant.":
    "Estas linhas são idênticas a linhas já importadas, com base nos critérios que você definiu para a predefinição. Você pode importá-las desmarcando-as.",
  "Les lignes d'en-tête et d'informations qui ne sont pas des opérations. N'utilise pas ceci pour gérer des doublons, une fonctionnalité est présente pour ça.":
    "As linhas de cabeçalho e de informação que não são transações. Não use isto para tratar duplicatas, existe um recurso para isso.",
  "Quelles colonnes l'app doit lire ou non pour identifier un doublon.":
    "Quais colunas o app deve ler ou não para identificar uma duplicata.",
  "Les mots-clés indiquant si ligne sort ou entre. Ajoute-les un par un avec « + » ou Entrée ; insensible aux majuscules et accents.":
    "As palavras-chave que indicam se a linha sai ou entra. Adicione-as uma a uma com « + » ou Enter; não diferencia maiúsculas nem acentos.",
  "Les mots-clés indiquant l'état de l'opération : utile si ton fichier renseigne des status (ex : en attente, complété, annulé).":
    "As palavras-chave que indicam o estado da transação: úteis se o seu arquivo informa status (ex: pendente, concluído, cancelado).",
  "Même fonctionnement que pour les catégories : enregistre la correspondance une fois pour toutes.":
    "Mesmo funcionamento das categorias: salve a correspondência uma vez por todas.",
  "Ces libellés ont déjà leur correspondance : simplement là pour vérifier avant de confirmer.":
    "Estes rótulos já têm sua correspondência: estão aqui apenas para você conferir antes de confirmar.",
  "Annuler un import retire les opérations qu'il avait créées, qu'elles aient été modifiées ou non.":
    "Cancelar uma importação remove as transações que ela havia criado, tenham sido modificadas ou não.",
  "L'application lit et écrit dans un seul fichier .db. « Basculer » permet de lire un fichier différent. « Créer / déplacer ici » déplace la base actuelle dans le nouveau dossier.":
    "O aplicativo lê e grava em um único arquivo .db. « Trocar » permite ler um arquivo diferente. « Criar / mover para cá » move o banco atual para a nova pasta.",
  "Clique sur l'œil pour lire ou ignorer une colonne. Les colonnes proposées dépendent de ce que le fichier contient : une liste d'opérations lit une date et un type, une photographie lit une quantité détenue et un prix de revient.":
    "Clique no olho para ler ou ignorar uma coluna. As colunas oferecidas dependem do que o arquivo contém: uma lista de transações lê uma data e um tipo, uma posição lê uma quantidade detida e um preço médio.",
  "Une règle reconnaît une ligne à son libellé et dit ce qu'elle est : achat, vente, transfert d'espèces. Elle vaut pour tous tes courtiers et passe avant les mots-clés du preset. Les mots-clés de la « Configuration du fichier » comparent un libellé entier : « Achat » est un achat, et rien d'autre ne l'est. Quand le courtier écrit une phrase — « ACHAT COMPTANT ETF MSCI WORLD », avec le nom du titre dedans — aucune liste de mots-clés ne peut la reconnaître, parce qu'il n'y a pas deux fois le même libellé dans le fichier. Une règle, elle, sait dire « contient ACHAT ». Elles sont évaluées de haut en bas et s'arrêtent à la première qui correspond : contrairement aux règles bancaires, une règle de placement ne décide que d'une chose, il n'y a donc rien à compléter en dessous. Place les cas particuliers au-dessus des cas généraux. Une ligne qu'aucune règle ne reconnaît retombe sur les mots-clés du preset. Sans aucune règle, l'import se comporte donc exactement comme avant.":
    "Uma regra reconhece uma linha pela sua descrição e diz o que ela é: compra, venda, transferência de dinheiro. Vale para todas as suas corretoras e vem antes das palavras-chave da predefinição. As palavras-chave da « Configuração do arquivo » comparam uma descrição inteira: « Compra » é uma compra, e nada mais é. Quando a corretora escreve uma frase — « ACHAT COMPTANT ETF MSCI WORLD », com o nome do título dentro — nenhuma lista de palavras-chave consegue reconhecê-la, porque não há duas vezes a mesma descrição no arquivo. Uma regra, essa, sabe dizer « contém ACHAT ». Elas são avaliadas de cima para baixo e param na primeira que corresponde: ao contrário das regras bancárias, uma regra de investimentos decide uma única coisa, portanto não há nada a completar abaixo. Coloque os casos particulares acima dos casos gerais. Uma linha que nenhuma regra reconhece volta às palavras-chave da predefinição. Sem nenhuma regra, a importação se comporta portanto exatamente como antes.",
  "C'est l'extension te permettant d'importer des relevés pour tes titres de placements (nécessite l'extension Placements). Le mécanisme d'import est le même que celui pour l'import d'informations, et l'information clé est l'ISIN d'un titre - un identifiant unique.":
    "É a extensão que permite importar extratos dos seus títulos de investimento (requer a extensão Investimentos). O mecanismo de importação é o mesmo da importação de informações, e a informação-chave é o ISIN de um título - um identificador único.",
  "Pour renseigner les intérêts perçus sur tes comptes de placements. Pense à les remettre à 0 si un import de relevé les importe.":
    "Para informar os juros recebidos nas suas contas de investimentos. Lembre-se de zerá-los se uma importação de extrato os trouxer.",
  "À quoi ton portefeuille est exposé : actions, obligations, immobilier, monétaire ?":
    "A que a sua carteira está exposta: ações, renda fixa, imóveis, monetário?",
  "Comment ton portefeuille est détenu : quelles sont les enveloppes que tu utilises ?":
    "Como a sua carteira é mantida: quais veículos você usa?",
  "Permet d'utiliser la fonctionnalité tout convertir du dashboard pour une vue complète. Tes opérations ne sont jamais modifiées, uniquement l'affichage du dashboard.":
    "Permite usar o recurso converter tudo do painel para uma visão completa. Suas transações nunca são modificadas, apenas a exibição do painel.",
  "Les titres que tu utilises sur l'app. Le cours se saisit à la main ou se lit en ligne avec l'extension Lecture de cours.":
    "Os títulos que você usa no app. A cotação é informada à mão ou lida online com a extensão Leitura de cotações.",
  "Voir l'infobulle plus bas.":
    "Veja a dica mais abaixo.",
  "Sous quelle forme tes titres sont détenus : ETF, action en direct, fonds et SCPI sont livrés par défaut.":
    "Sob qual forma seus títulos são mantidos: ETF, ação direta, fundos e SCPI vêm por padrão.",
  "À quel type d'objet financier tes avoirs t'exposent-ils ?":
    "A que tipo de objeto financeiro seus ativos expõem você?",
  "Toutes les opérations qui entrent dans le chiffre de la carte, sur la vue choisie : la plus grosse d'abord. Le montant retenu est ce que chacune pèse dans l'objectif — son reste à charge si elle est remboursable, sa part si elle est découpée, la part du mois si elle est amortie (son montant réel est écrit en dessous, et le nombre de mois d'amortissement entre crochets après la date). La somme des montants retenus est le chiffre de la carte, avant d'être ramenée à la cadence ou divisée par le nombre de dépenses selon ce que l'objectif mesure.":
    "Todas as transações que entram no número do cartão, na visão escolhida: a maior primeiro. O valor retido é o que cada uma pesa na meta — a parte que fica com você se for reembolsável, sua parte se for dividida, a parte do mês se for diluída (o valor real vem escrito embaixo, e o número de meses de diluição entre colchetes após a data). A soma dos valores retidos é o número do cartão, antes de ser ajustado à cadência ou dividido pelo número de despesas, conforme o que a meta mede.",
  "Rassemble des opérations déjà saisies, quelles que soient leur catégorie et leur compte, pour lire ce qu'un voyage ou un déménagement t'a coûté. Une opération peut appartenir à plusieurs projets, et rien d'autre dans l'app n'en tient compte. Un projet ne se saisit pas depuis une opération : on le crée ici, puis on y verse les opérations concernées. C'est un regroupement de LECTURE — retirer une opération d'un projet ne la supprime pas, et supprimer un projet ne supprime aucune dépense.":
    "Reúne transações já lançadas, quaisquer que sejam a categoria e a conta, para ler o que uma viagem ou uma mudança custou a você. Uma transação pode pertencer a vários projetos, e nada mais no app os leva em conta. Um projeto não se cria a partir de uma transação: ele é criado aqui, depois colocam-se nele as transações em questão. É um agrupamento de LEITURA — retirar uma transação de um projeto não a exclui, e excluir um projeto não exclui nenhuma despesa.",
  "Une règle reconnaît des lignes à leur libellé et dit ce qu'elles sont : virement interne, prêt, dépense remboursable… Elle peut aussi poser la catégorie, et passe avant tout le reste. Une règle classe automatiquement les lignes importées d'après leurs libellés — c'est le seul moyen de marquer une ligne « remboursable » ou de la classer en Prêt / Remboursement sans le faire à la main. Les règles sont communes à tous les presets d'import. Elles sont évaluées de haut en bas, et s'arrêtent à la première qui correspond — sauf si celle-ci décoche « Arrêter la lecture des règles ici ». Plusieurs règles peuvent alors s'appliquer à une même ligne, mais aucune ne défait ce qu'une règle plus haute a décidé : en cas de désaccord, la plus haute gagne. Place les cas particuliers au-dessus des cas généraux. Les règles passent avant les correspondances mémorisées : un type reconnu ici ne peut plus être défait par une correspondance de catégorie. Les dossiers ne servent qu'à s'y retrouver : ils ne changent pas l'ordre d'évaluation, qui reste celui de la vue liste (le numéro sur chaque carte le rappelle). Fais glisser une règle d'un dossier à l'autre pour la ranger. Ce classement reste sur cet ordinateur — il n'est pas enregistré dans la base.":
    "Uma regra reconhece linhas pela descrição e diz o que elas são: transferência interna, empréstimo, despesa reembolsável… Ela também pode definir a categoria, e vem antes de tudo o mais. Uma regra classifica automaticamente as linhas importadas conforme suas descrições — é o único modo de marcar uma linha como « reembolsável » ou de classificá-la como Empréstimo / Pagamento sem fazer à mão. As regras são comuns a todas as predefinições de importação. Elas são avaliadas de cima para baixo e param na primeira que corresponde — a menos que ela desmarque « Parar a leitura das regras aqui ». Várias regras podem então se aplicar à mesma linha, mas nenhuma desfaz o que uma regra mais alta decidiu: em caso de desacordo, a mais alta vence. Coloque os casos particulares acima dos casos gerais. As regras vêm antes das correspondências memorizadas: um tipo reconhecido aqui não pode mais ser desfeito por uma correspondência de categoria. As pastas servem apenas para você se orientar: não mudam a ordem de avaliação, que continua sendo a da visão em lista (o número em cada cartão lembra isso). Arraste uma regra de uma pasta para outra para organizá-la. Essa organização fica neste computador — não é salva no banco de dados.",
  "L'une des extensions phares de l'application. Ta banque fournit un libellé conséquent pour des dépenses récurrentes, que tu dois renommer sans cesse ? Tu voudrais automatiser les modifications récurrentes que tu fais ? L'extension règle t'apporte la flexibilité de faire /bold(ce que tu veux).":
    "Uma das extensões principais do aplicativo. Seu banco fornece uma descrição extensa para despesas recorrentes, que você precisa renomear sem parar? Gostaria de automatizar as modificações recorrentes que faz? A extensão de regras traz a flexibilidade de fazer /bold(o que você quiser).",
  "Si ton preset lit la colonne « Notes » du relevé, une condition peut aussi porter sur elle : utile quand la banque écrit la référence utile dans le commentaire plutôt que dans le libellé.":
    "Se a sua predefinição lê a coluna « Notas » do extrato, uma condição também pode se basear nela: útil quando o banco escreve a referência útil no comentário em vez de na descrição.",
  "Rien ne s'affiche d'office : « + Ajouter un champ » pose une propriété à la fois, et la croix la retire. Même geste que dans les sorties conditionnelles, juste en dessous.":
    "Nada aparece de início: « + Adicionar um campo » coloca uma propriedade por vez, e a cruz a remove. Mesmo gesto das saídas condicionais, logo abaixo.",
  "La colonne « Notes » est éteinte au départ. Allume-la si ton relevé porte un commentaire ou une référence : il est recopié dans la note de l'opération, et tes règles peuvent s'en servir.":
    "A coluna « Notas » vem desligada. Ligue-a se o seu extrato traz um comentário ou uma referência: ele é copiado para a nota da transação, e suas regras podem usá-lo.",
  "Le type détermine ce qui suit : seules « Opération classique » et « Dépense remboursable » laissent choisir une catégorie — les autres types imposent la leur. Chaque part dit combien elle prend. On peut écrire un nombre (50), un pourcentage (30%), une opération (montant - 50), ou utiliser min et max — par exemple min(montant; 50) pour « au plus 50 € ». Le mot reste donne à une part tout ce que les autres n'ont pas pris ; une seule part peut le porter, et la somme doit valoir le montant de la ligne.":
    "O tipo determina o que vem a seguir: apenas « Transação padrão » e « Despesa reembolsável » permitem escolher uma categoria — os outros tipos impõem a sua. Cada parte diz quanto leva. Pode-se escrever um número (50), uma porcentagem (30%), um cálculo (montant - 50), ou usar min e max — por exemplo min(montant; 50) para « no máximo 50 € ». A palavra reste dá a uma parte tudo o que as outras não levaram; só uma parte pode usá-la, e a soma deve valer o valor da linha.",
  "Un commentaire, une référence ou un mémo que ta banque écrit à côté du libellé.\n\nIl est recopié dans les notes de l'opération (sauf si une règle en pose une), et tes règles peuvent le tester comme le libellé.":
    "Um comentário, uma referência ou um memorando que o seu banco escreve ao lado da descrição.\n\nEle é copiado para as notas da transação (a menos que uma regra defina uma), e suas regras podem testá-lo como a descrição.",
  "Chaque colonne lue est colorée et porte le nom de la propriété qui sera importée. Les colonnes grises sont ignorées. Si une couleur ne tombe pas en face des bonnes données, corrige les numéros de colonne dans « Configuration du fichier » au-dessus.":
    "Cada coluna lida é colorida e traz o nome da propriedade que será importada. As colunas cinzas são ignoradas. Se uma cor não cair diante dos dados certos, corrija os números de coluna em « Configuração do arquivo » acima.",
  "Chaque ligne devient un achat daté du jour de la photographie : c'est ainsi qu'une détention existe dans l'application, et c'est ce qui rend justes d'un coup la valorisation et les plus-values. Les espèces du compte baissent donc du total investi — pense à poser son solde initial en conséquence.":
    "Cada linha vira uma compra datada do dia da posição: é assim que uma posição existe no aplicativo, e é o que torna corretas de uma só vez a valorização e os ganhos. O dinheiro da conta cai portanto do total investido — lembre-se de definir o saldo inicial de acordo.",
  "Ces transferts ressemblent à un virement déjà enregistré : même montant, mêmes comptes, à quelques jours près. C'est normal — le même mouvement figure sur le relevé du courtier et sur celui du compte courant. Seuls les virements qui touchent le compte de ce preset sont comparés. Rien n'est bloqué ni pré-sélectionné : toi seul sais si tu as vraiment fait deux fois le mouvement. Chaque ligne est suivie de ce à quoi elle ressemble.":
    "Estas transferências se parecem com uma transferência já registrada: mesmo valor, mesmas contas, com poucos dias de diferença. É normal — o mesmo movimento figura no extrato da corretora e no da conta corrente. Só as transferências que tocam a conta desta predefinição são comparadas. Nada é bloqueado nem pré-selecionado: só você sabe se realmente fez o movimento duas vezes. Cada linha é seguida do que ela parece.",
  "Ces lignes ne seront pas importées telles quelles. Corrige-les avec « Modifier », ou supprime-les de l'aperçu — le reste du fichier s'importe normalement.":
    "Estas linhas não serão importadas como estão. Corrija-as com « Modificar », ou exclua-as da pré-visualização — o resto do arquivo é importado normalmente.",
  "C'est LA page pour pouvoir tenir ton budget. // Elle te permet de sélectionner un budget pour ton mois et de choisir des budgets par catégorie. // Tu peux l'utiliser pour comparer les graphiques du dashboard sur différentes périodes, et mieux comprendre comme tu gères ton argent avec plus de recul. // Elle te permet également d'avoir accès à trois nouveaux indicateurs : /- L'argent que tu as mis de côté sur la période (virements internes vers tes comptes d'épargne ou de placements) /- Un matelas de sécurité que tu définis, utile pour s'assurer que ce dernier se porte bien /- La classification de dépenses comme étant imprévues, et le montant de ces imprévus sur la période : cet indicateur te permet de mieux comprendre ce qu'on n'anticipe jamais et qu'on finit par souvent par définir comme impossible à prendre en compte dans le budget ":
    "É A página para conseguir manter o seu orçamento. // Ela permite definir um orçamento para o seu mês e escolher orçamentos por categoria. // Você pode usá-la para comparar os gráficos do painel em diferentes períodos e entender melhor como você lida com o seu dinheiro, com mais perspectiva. // Ela também dá acesso a três novos indicadores: /- O dinheiro que você guardou no período (transferências internas para suas contas poupança ou de investimentos) /- Uma reserva de segurança que você define, útil para garantir que ela vá bem /- A classificação de despesas como imprevistas, e o valor desses imprevistos no período: esse indicador permite entender melhor o que nunca se antecipa e que acabamos muitas vezes definindo como impossível de levar em conta no orçamento ",
  "Un compte d'épargne te rapporte de l'argent passivement, à des fréquences différences (journalier, mensuel, annuel, ...). Néanmoins, une opération ne s'écrit pas pour autant dans tes relevés - l'app affichera donc un montant erroné pour ton compte de placements quand tes intérêts apparaîtront sur ton compte. // Cette extension - s'affichant dans la page Vue des avoirs /Vue des avoirs - te permet de renseigner à la main ces intérêts et les assigner à un compte de placements.":
    "Uma conta poupança rende dinheiro passivamente, em frequências diferentes (diária, mensal, anual, ...). Contudo, nenhuma transação é escrita nos seus extratos por isso — o app exibirá portanto um valor errado para a sua conta de investimentos quando os juros aparecerem na sua conta. // Esta extensão - exibida na página Visão dos ativos /Visão dos ativos - permite informar à mão esses juros e atribuí-los a uma conta de investimentos.",
  "Cette extension te permet d'avoir une vue d'ensemble sur les actifs que tu possèdes (nécessite l'extension Placements), avec plusieurs classifications (type d'actifs, d'enveloppes) pour mieux comprendre ce que tu possèdes, comment et à quoi tes actifs t'exposent.":
    "Esta extensão permite ter uma visão geral dos ativos que você possui (requer a extensão Investimentos), com várias classificações (tipo de ativo, veículos) para entender melhor o que você possui, como, e a que os seus ativos expõem você.",
  "IMPORTANT : cette extension est la seule à te permettre de relier ton app à internet. Elle te permet de fournir des liens de pages de cotation pour que l'app les utilise : elle nécessite l'extension Placements financiers (lecture de cours d'actifs) ou Monnaies (lecture de taux de change).":
    "IMPORTANTE: esta extensão é a única que permite conectar o seu app à internet. Ela permite fornecer links de páginas de cotação para o app usar: requer a extensão Investimentos (leitura de cotações de ativos) ou Moedas (leitura de taxas de câmbio).",
  "Sans cette extension, l'application est mono-devise. L'activer te permet de créer de nouvelles monnaies, et donc de relier des dépenses ou des comptes à différentes monnaies pour ne pas mélanger ce qui ne se mélange.":
    "Sem esta extensão, o aplicativo usa uma única moeda. Ativá-la permite criar novas moedas e, assim, vincular despesas ou contas a moedas diferentes para não misturar o que não se mistura.",
  "Cette extension te permet de créer des objectifs personnalisés pour gérer tes dépenses comme tu le souhaites. Tu peux créer des indicateurs personnalisés prenant en compte la fréquence, le montant moyen, le montant total, une part, pour comprendre et agir plus en détails qu'avec de simples limites sur des catégories (ex : mes courses devraient 300€ en moyenne par mois / je vise 2 sorties resto max par semaine / j'épargne au moins 50€ par mois).":
    "Esta extensão permite criar metas personalizadas para gerenciar suas despesas como você quiser. Você pode criar indicadores personalizados levando em conta a frequência, o valor médio, o valor total, uma participação, para entender e agir com mais detalhe do que com simples limites em categorias (ex: minhas compras de mercado devem ficar em 300 € em média por mês / miro no máximo 2 saídas a restaurante por semana / poupo pelo menos 50 € por mês).",
  "Grâce à cette extension, tu peux renseigner et comprendre les actifs que tu détiens (achat, vente, plus-value, valorisation). Une fois activée, tu retrouveras cette page en onglet de la page Vue des avoirs /Vue des avoirs.":
    "Graças a esta extensão, você pode registrar e entender os ativos que possui (compra, venda, ganho, valorização). Uma vez ativada, você encontrará esta página como uma aba da página Visão dos ativos /Visão dos ativos.",
  "Te permet de classifier comme tel et suivre l'argent qu'on t'a prêté (intérêts compris). Le fonctionnement de ces types d'opérations est similaire aux opérations remboursables / remboursements.":
    "Permite classificar como tal e acompanhar o dinheiro que lhe emprestaram (juros incluídos). O funcionamento desses tipos de transação é parecido com o das despesas reembolsáveis / reembolsos.",
  "Un voyage, un investissement dans une activité sous différentes formes, des rénovations ? Difficile de suivre ça avec seulement des catégories. Tu peux donc créer un projet, et y rajouter toutes les opérations que tu veux. Tu obtiens alors une vue détaillée de ce que ton projet t'a coûté - ou rapporté - classifié en catégories.":
    "Uma viagem, um investimento em uma atividade sob diversas formas, reformas? Difícil acompanhar isso só com categorias. Você pode então criar um projeto e adicionar a ele todas as transações que quiser. Você obtém então uma visão detalhada do que o seu projeto custou a você - ou rendeu - classificada em categorias.",
  "On te doit de l'argent à droite à gauche, et tu dois des dépenses, des montants, de combien on t'a remboursé et des personnes de tête ? // Active cette extension pour avoir accès à deux types d'opérations : /- les opérations remboursables : tu peux y sélectionner le montant à rembourser, le montant dû et l'extension te permet d'ajouter qui te doit l'argent via le menu Suivi des remboursements /- les remboursements reçus : comme une opération classique, que tu peux relier à l'opération remboursable - le montant dû se met alors automatiquement à jour // /italic(La page Suivi des remboursements te permet de voir tous tes remboursements en attente et indiquer qui te doit quoi.)":
    "Devem dinheiro a você aqui e ali, e você deve despesas, valores, quanto lhe reembolsaram e pessoas de cabeça? // Ative esta extensão para ter acesso a dois tipos de transação: /- as despesas reembolsáveis: você pode selecionar nelas o valor a reembolsar, o valor devido e a extensão permite adicionar quem lhe deve o dinheiro pelo menu Acompanhamento de reembolsos /- os reembolsos recebidos: como uma transação padrão, que você pode vincular à despesa reembolsável - o valor devido é então atualizado automaticamente // /italic(A página Acompanhamento de reembolsos permite ver todos os seus reembolsos pendentes e indicar quem lhe deve o quê.)",
  "Semaine affichée":
    "Semana exibida",
  "Mois en cours":
    "Este mês",
  "Mois affiché":
    "Mês exibido",
  "Moyenne de l'année":
    "Média do ano",
  "Moyenne sur tout l'historique":
    "Média de todo o histórico",
  "Depuis":
    "Desde",
  "Voir les opérations":
    "Ver as transações",
  "← Retour aux objectifs":
    "← Voltar às metas",
  "Opérations qui entrent en compte —":
    "Transações que entram na conta —",
  "Aucune opération n'entre en compte sur cette période.":
    "Nenhuma transação entra na conta neste período.",
  "Montant retenu":
    "Valor retido",
  "Total retenu":
    "Total retido",
  "Catégorie d'entrée":
    "Categoria de entrada",
  "Dépenses prévues reconnues —":
    "Despesas previstas reconhecidas —",
  "Aucun titre détenu pour le moment. Achète ou importe des titres depuis la page Placements financiers, et la répartition apparaîtra ici.":
    "Nenhum título em carteira por enquanto. Compre ou importe títulos na página Investimentos, e a distribuição aparecerá aqui.",
  "entrée":
    "entrada",
  "ex. EDF":
    "ex. EDF",
  "Aucun mot-clé : le compte, le montant et la date suffisent à reconnaître la dépense.":
    "Nenhuma palavra-chave: a conta, o valor e a data bastam para reconhecer a despesa.",
  "Modifier le virement":
    "Modificar a transferência",
  "Supprimer ce virement ? Les deux lignes liées (sortante et entrante) seront supprimées.":
    "Excluir esta transferência? As duas linhas vinculadas (de saída e de entrada) serão excluídas.",
  "- À choisir -":
    "- Escolher -",
  "Dépenses réglées":
    "Despesas quitadas",
  "Ajouter un groupe":
    "Adicionar um grupo",
  "Le budget de chaque mois, il reprend la valeur du dernier mois par défaut. Il relie les objectifs par catégorie en pourcentage et en valeur.":
    "O orçamento de cada mês; por padrão ele retoma o valor do último mês. Ele relaciona as metas por categoria em porcentagem e em valor.",
  "Un commentaire, une référence ou un mémo que ta banque écrit à côté du libellé. Il est recopié dans les notes de l'opération (sauf si une règle en pose une), et tes règles peuvent le tester comme le libellé.":
    "Um comentário, uma referência ou um memorando que o seu banco escreve ao lado da descrição.\n\nEle é copiado para as notas da transação (a menos que uma regra defina uma), e suas regras podem testá-lo como a descrição.",
  "C'est LA page pour pouvoir tenir ton budget. // Elle te permet de sélectionner un budget pour ton mois et de choisir des budgets par catégorie. // Tu peux l'utiliser pour comparer les graphiques du dashboard sur différentes périodes, et mieux comprendre comme tu gères ton argent avec plus de recul. // Elle te permet également d'avoir accès à trois nouveaux indicateurs : /- L'argent que tu as mis de côté sur la période (virements internes vers tes comptes d'épargne ou de placements) /- Un matelas de sécurité que tu définis, utile pour s'assurer que ce dernier se porte bien /- La classification de dépenses comme étant imprévues, et le montant de ces imprévus sur la période : cet indicateur te permet de mieux comprendre ce qu'on n'anticipe jamais et qu'on finit par souvent par définir comme impossible à prendre en compte dans le budget":
    "É A página para conseguir manter o seu orçamento. // Ela permite definir um orçamento para o seu mês e escolher orçamentos por categoria. // Você pode usá-la para comparar os gráficos do painel em diferentes períodos e entender melhor como você lida com o seu dinheiro, com mais perspectiva. // Ela também dá acesso a três novos indicadores: /- O dinheiro que você guardou no período (transferências internas para suas contas poupança ou de investimentos) /- Uma reserva de segurança que você define, útil para garantir que ela vá bem /- A classificação de despesas como imprevistas, e o valor desses imprevistos no período: esse indicador permite entender melhor o que nunca se antecipa e que acabamos muitas vezes definindo como impossível de levar em conta no orçamento",
  "Dashboard":
    "Painel",
};

// Les onglets dont le mot est le même en anglais et en français.
TRADUCTIONS.pt["Configuration"] = "Configuração";

MOTIFS_PAR_LANGUE.pt = [
  [/^Monnaie du compte (.+) introuvable$/, "Moeda da conta $1 não encontrada"],
  [/^Monnaie (.+) introuvable$/, "Moeda $1 não encontrada"],
  [/^Opération (.+) introuvable$/, "Transação $1 não encontrada"],
  [/^Fichier illisible en tant que base SQLite : (.+)$/, "Arquivo ilegível como banco de dados SQLite: $1"],
  [/^Fichier illisible : (.+)$/, "Arquivo ilegível: $1"],
  [/^Impossible de mettre à jour le schéma de (.+) : (.+)$/, "Não foi possível atualizar o esquema de $1: $2"],
  [/^Ce compte porte déjà des opérations en (.+) : supprime-les avant de retirer cette monnaie\.$/, "Esta conta já tem transações em $1: exclua-as antes de remover esta moeda."],
  [/^Un même mot-clé ne peut pas désigner deux (.+) différents : (.+)$/, "Uma mesma palavra-chave não pode designar dois $1 diferentes: $2"],
  [/^Propriétés invalides : (.+)$/, "Propriedades inválidas: $1"],
  [/^Propriétés obligatoires manquantes : (.+)$/, "Propriedades obrigatórias ausentes: $1"],
  [/^Le compte « (.+) » ne porte pas cette monnaie \(possibles : (.+)\)\.$/, "A conta “$1” não tem esta moeda (possíveis: $2)."],
  [/^Le compte (.+) « (.+) » ne porte pas la monnaie de cette ligne \(possibles : (.+)\)$/, "A conta $1 “$2” não tem a moeda desta linha (possíveis: $3)"],
  [/^Le compte (.+) « (.+) » ne porte pas cette monnaie \(possibles : (.+)\)\.$/, "A conta $1 “$2” não tem esta moeda (possíveis: $3)."],
  [/^Le type « (.+) » est géré par l'onglet Placements financiers et ne peut pas être posé ici\.$/, "O tipo “$1” é gerenciado pela página Investimentos e não pode ser definido aqui."],
  [/^Le type « (.+) » ne peut pas être posé par une règle : les achats\/ventes de titres se saisissent depuis l'onglet Placements financiers\.$/, "O tipo “$1” não pode ser definido por uma regra: as compras/vendas de títulos são lançadas a partir da página Investimentos."],
  [/^Le total réglé \((.+)\) dépasse le montant de l'opération de règlement \((.+)\)$/, "O total quitado ($1) ultrapassa o valor da transação de acerto ($2)"],
  [/^operations_remboursees n'est valide que pour les types (.+)$/, "operations_remboursees só é válido para os tipos $1"],
  [/^L'opération (.+) ne peut pas être réglée par une opération de type '(.+)'$/, "A transação $1 não pode ser quitada por uma transação do tipo '$2'"],
  [/^L'opération (.+) n'est pas dans la même monnaie que ce règlement : l'app ne convertit rien, règle-la depuis une opération de sa monnaie\.$/, "A transação $1 não está na mesma moeda que este acerto: o app não converte nada, quite-a a partir de uma transação da moeda dela."],
  [/^Le montant réglé pour l'opération (.+) dépasse le montant dû \((.+)\)$/, "O valor quitado para a transação $1 ultrapassa o valor devido ($2)"],
  [/^« (.+) » est coté en (.+), monnaie que le compte « (.+) » ne porte pas : ajoute-la au compte \(Paramètres > Comptes\) ou choisis un autre titre\.$/, "“$1” é cotado em $2, moeda que a conta “$3” não tem: adicione-a à conta (Ajustes > Contas) ou escolha outro título."],
  [/^Quantité insuffisante : (.+) « (.+) » détenu\(s\) sur ce compte, (.+) demandé\(s\)$/, "Quantidade insuficiente: $1 “$2” em carteira nesta conta, $3 solicitado(s)"],
  [/^champ inconnu : (.+) \(attendus : (.+)\)$/, "campo desconhecido: $1 (esperados: $2)"],
  [/^Import bloqué : (.+) ligne\(s\) portent des frais dans une monnaie qui n'est ni celle du montant ni celle du montant envoyé \(ligne (.+)\)\. Retire la colonne « Frais » de la configuration avancée, ou corrige la colonne de devise qui la qualifie\.$/, "Importação bloqueada: $1 linha(s) têm tarifas em uma moeda que não é nem a do valor nem a do valor enviado (linha $2). Remova a coluna “Tarifas” da configuração avançada, ou corrija a coluna de moeda que a qualifica."],
  [/^monnaie « (.+) » non résolue$/, "moeda “$1” não resolvida"],
  [/^sens « (.+) » non reconnu \(attendus : (.+)\)$/, "sentido “$1” não reconhecido (esperados: $2)"],
  [/^état « (.+) » non reconnu \(attendus : (.+)\)$/, "estado “$1” não reconhecido (esperados: $2)"],
  [/^frais en « (.+) » : ce n'est pas la monnaie (.+) à laquelle ils devraient s'appliquer$/, "tarifas em “$1”: esta não é a moeda $2 à qual elas deveriam se aplicar"],
];
