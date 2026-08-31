# Budget App

Salut salut, si tu lis ceci c'est sûrement que je t'ai eu avec une accroche digne des plus grands politiciens. 

Petit disclaimer avant de rentrer dans le vif du sujet : cette app a été entièrement conçue à l'aide de Claude Code. Si c'est quelque chose qui te dérange ou à laquelle tu t'opposes, je préfère que tu le saches.

Cette app est née suite au besoin que j'avais de suivre mes dépenses. Pendant à peu près un an, Excel s'est avéré suffisant. Mais force est de constater qu'avec plusieurs comptes, devises et d'autres raisons, l'outil n'est pas le plus pratique. 
De là, j'ai re-employé ce que j'avais appris, ce qu'il me manquait et ce que je voulais pouvoir faire en gérant mes dépenses dans un but : avoir une app qui regroupe tout.

Je vais être concis pour que t'en profites pour voir par toi-même plutôt qu'imaginer en lisant. 

L'app vient en deux morceaux : 
- L'app principale, qui inclut les fonctionnalités de bases 
- Des extensions, téléchargeables depuis le Git et activables / désactivables à volonté 

Pourquoi des extensions si elles sont gratuites ? Deux raisons à ça : 

1 - Rendre l'app personnalisable, minimaliste et pratique à utiliser. Tu peux te servir dans les extensions, les tester, les désactiver / désinstaller et ne garder que celles qui te servent pour une app plus épurée.
2 - L'une des extensions inclut une connexion à l'internet (lecture de cours, plus de détails plus dans le ReadMe des extensions)

Et ça nous amène à l'un des points les plus importants : l'app tourne 100% hors-ligne et ne communique jamais avec internet. C'est une mesure à la fois de facilité (plus simple que de créer un agrégateur de comptes) et de sûreté : tes informations bancaires sont dans une base de données sur ta machine, et elles y restent.

Pour l'instant, je t'invite à commencer sans activer d'extensions pour pas ajouter trop de complexité : une fois installée, crée un ou des comptes, une propriété de l'app et nullement un compte nécessitant une identification (répliquant ton/tes comptes en banque) et des catégories d'opérations.

Ensuite, jette un oeil aux différents types d'opérations : 
- Opération classique, ras
- Dépense remboursable : comme précédemment, mais tu peux indiquer un montant à rembourser. Ca va affecter ton montant prévisionnel et ça s'affichera comme en attente de remboursement.
- Remboursements : pour les remboursements que tu recevras. Tu peux lier une opération de ce type à une ou plusiers opérations remboursables, en spécifiant les montants affectés à chaque dépense remboursable. Deux choses à avoir en tête : 
	- Le montant remboursé ne peut pas dépasser le montant à rembourser (encore moins le montant total de l'opération remboursable)
	- La somme des montants affectés à différentes opérations remboursable ne dépasse pas le montant du remboursement
Rien de nouveau sous le soleil, juste des précautions logiques/

Te voilà prêt. Maintenant, tu peux créer tes premières opérations ou les importer via le menu d'import. 

La première importation est toujours plus longue car il faut régler les différents paramètres de ton preset d'importation. Note que l'app ne permet que l'importation au format excel ou csv :)

Au début l'app peut paraître longue à prendre en main. 
Mais quand quelques paramètres sont configurés, tu peux suivre l'évolution de tes comptes de manière flexible - en arrangeant tes dépenses comme tu le souhaites - en quelques clics.

Des tooltips sont disséminés un peu partout pour quelques explications plus approfondies "i". Enfin, si vous avez des questions ou des propositions, n'hésitez pas à m'en faire part :)

Merci d'avoir lu jusque ici ! 

PS : si vous avez des suggestions pour le nom, je suis preneur.


## Installer l'application

Va chercher l'archive correspondant à ton système sur la page
[Releases](../../releases), décompresse-la quelque part où tu as le droit
d'écrire (évite `Program Files` : l'application y crée sa base de données à
côté d'elle-même), et lance `Budget App`.

Comme elle n'est pas signée numériquement — cette signature coûte de l'argent
chez Microsoft comme chez Apple — ton système va probablement s'inquiéter au
premier lancement. Rien d'anormal :

| Système | Ce qu'il faut faire |
|---|---|
| **Windows** | SmartScreen affiche un écran bleu : clique *Informations complémentaires*, puis *Exécuter quand même*. |
| **macOS** | Clic droit sur l'app → *Ouvrir*, et confirme. Un double-clic classique sera refusé la première fois. Détails : [macOS](desktop/platforms/macos/README.md). |
| **Linux** | Un paquet à installer avant de lancer l'app (le moteur d'affichage) : [Linux](desktop/platforms/linux/README.md). |


L'application arrive sans aucune extension activée — le dossier `extensions/`
est vide au départ, et c'est volontaire.

Pour en ajouter une : télécharge son archive sur la page
[Releases](../../releases), décompresse-la dans `extensions/`, puis relance
l'application. Elle la détecte toute seule et te propose de l'activer.

```
Budget App/
  Budget App.exe
  data/                 ta base de données
  extensions/
    placements/         <- le dossier décompressé
```


Toute erreur au démarrage est écrite en détail dans `erreur.log`, à côté de la
base de données. Regarde d'abord là, et joins ce fichier si tu me signales le
problème.

Point légal, par mesure de sécurité. L'app est sous license pour un usage personnel. Aucune licence d'exploitation n'est accordée. 
Tu peux jeter un oeil au fichier license pour des clarifications.
