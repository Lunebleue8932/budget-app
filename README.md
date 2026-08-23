# Budget App

Gestionnaire de budget personnel, **entièrement hors ligne**. Suivi des comptes
et des opérations, import de relevés bancaires (Excel/CSV), budgets par
catégorie, virements internes, prêts et remboursements, amortissement des
grosses dépenses. Le multi-devises s'ajoute par une extension, et ne mélange
jamais deux monnaies.

## Tes données ne quittent jamais ta machine

L'application n'émet **aucune requête vers Internet**. Ce n'est pas une
promesse mais une propriété du code, vérifiable :

- aucune bibliothèque HTTP cliente n'est utilisée ;
- le serveur local écoute sur `127.0.0.1` (boucle locale), sur un port choisi
  par le système — il est inaccessible depuis le réseau, même local ;
- l'interface ne charge **aucune ressource externe** : ni police, ni script,
  ni image distante. Tout est servi depuis le dossier de l'application ;
- les cours de bourse (extension Placements) sont **saisis à la main** :
  aucune API financière n'est consultée ;
- aucune télémétrie, aucune statistique d'usage, aucune mise à jour automatique.

Ta base de données est un simple fichier `.db` que tu peux copier, sauvegarder
ou supprimer toi-même.

### Une seule extension communique avec le web, et c'est toi qui l'allumes

Tout ce qui précède décrit l'application et les extensions livrées avec elle.
**Une** extension fait exception, et elle seule : **Placements financiers —
cours en ligne**, qui va lire le cours de tes titres sur la page de cotation
dont **tu** as collé le lien.

Deux gestes explicites sont nécessaires pour qu'elle communique, et l'un ne
suffit pas sans l'autre :

1. **la déposer** dans `extensions/` — tant qu'elle n'y est pas, le code
   capable d'ouvrir une connexion sortante n'existe pas sur ta machine ;
2. **cocher sa case**, au lancement ou dans Paramètres → Extensions. Une
   extension trouvée arrive **éteinte** : ni son écran ni son code ne sont
   chargés, et fermer la fenêtre qui l'annonce ne l'allume pas.

Ce qu'elle fait, une fois allumée :

- elle ne va que sur les pages que tu as désignées, titre par titre ;
- elle envoie une requête `GET` et rien d'autre : **aucune donnée de ton budget**
  ne quitte la machine — ni tes comptes, ni tes montants, ni le nombre de titres
  que tu détiens. Le site visité apprend qu'une adresse IP a demandé une page
  publique, ce qu'il apprend de n'importe quel visiteur ;
- tout son code réseau tient dans un seul fichier lisible d'un trait,
  [`extensions/placements-web/source_cours.py`](extensions/placements-web/source_cours.py) ;
- la décocher arrête tout ; supprimer son dossier remet l'application dans
  l'état décrit plus haut, sans exception.

## Installation

Télécharge l'archive de ton système depuis la page
[Releases](../../releases), décompresse-la **dans un dossier où tu peux
écrire** (pas `Program Files` : la base est créée à côté de l'exécutable), puis
lance `Budget App`.

| Système | À savoir |
|---|---|
| **Windows** | Rien à installer. Windows peut afficher un avertissement SmartScreen à la première ouverture (application non signée) : *Informations complémentaires* → *Exécuter quand même*. |
| **macOS** | Application non signée : au premier lancement, **clic droit sur l'app → Ouvrir**, puis confirme. Un double-clic simple serait refusé par Gatekeeper. |
| **Linux** | Nécessite WebKit2GTK — voir [desktop/platforms/linux/README.md](desktop/platforms/linux/README.md). |

## Construire depuis les sources

Prérequis : Python 3.14.

```bash
python -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt pyinstaller pywebview
python desktop/generer_icone.py
```

Puis, selon le système :

```bash
sh desktop/construire.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File desktop\platforms\windows\construire.ps1
```

Le résultat est dans `desktop/dist/`.

## Organisation du dépôt

```
backend/     API FastAPI, modèles, migrations Alembic — générique
frontend/    interface (HTML/CSS/JS sans dépendance) — générique
desktop/     lanceur et empaquetage
  platforms/   ce qui diffère par système (windows/, linux/, macos/)
extensions/  fonctionnalités optionnelles livrées avec l'application
```

**Le code est générique par défaut.** Seuls trois comportements diffèrent d'un
système à l'autre (identité de la fenêtre, boîte d'erreur native, format
d'icône et empaquetage) : ils vivent dans `desktop/platforms/<système>/`, et
partout ailleurs le même code tourne sur les trois. Voir
[desktop/platforms/](desktop/platforms/) pour le détail.

## Extensions

Une extension est un dossier autonome qui ajoute une fonctionnalité.

**L'application est livrée sans aucune extension.** Le dossier `extensions/`
arrive vide, à côté de l'exécutable : c'est à toi d'y déposer celles que tu
veux. Rien n'est installé dans ton dos, et une extension que tu n'as pas
téléchargée n'existe pas — ni son écran, ni ses routes.

### Installer une extension

1. télécharge son archive `extension-*.zip` depuis les
   [Releases](../../releases) ;
2. décompresse-la dans le dossier `extensions/`, à côté de l'exécutable ;
3. relance l'application : elle te dit l'avoir trouvée, et te propose de
   l'allumer.

```
Budget App/
  Budget App.exe        (ou « Budget App » sous Linux, « Budget App.app » sous macOS)
  data/                 ta base de données
  extensions/
    placements/         <- le dossier décompressé
```

**Une extension trouvée arrive éteinte.** Rien d'elle n'est chargé — ni son
écran, ni son code — tant que tu n'as pas coché sa case : dans la fenêtre du
lancement, ou dans **Paramètres → Extensions**. Fermer cette fenêtre, d'un
bouton, d'un Échap ou d'un clic à côté, ne l'allume pas.

Cocher et décocher se fait ensuite à tout moment, sans redémarrer.
**Désactiver ne supprime jamais de données** : l'écran disparaît, les routes se
ferment, et tout réapparaît intact à la réactivation.

### Disponibles

- **Monnaies** — ajoute, renomme et supprime des monnaies, pour suivre des
  comptes et des budgets dans plusieurs devises. Sans elle, l'application est
  mono-devise : l'interface se replie d'elle-même sur la monnaie posée à
  l'installation. L'éteindre ne replie rien de force — une base qui porte déjà
  plusieurs monnaies continue de les afficher toutes.
- **Règles de catégorisation** — classe automatiquement les lignes d'un relevé
  d'après leurs libellés (type d'opération, catégorie, compte en face d'un
  virement), en vue liste ordonnée ou en vue galerie par dossiers. Sans elle,
  les lignes importées arrivent à classer à la main ; les règles déjà écrites
  restent en base et reprennent leur travail dès qu'on la rallume.
- **Placements financiers** — portefeuille de titres, achats/ventes,
  valorisation au dernier cours saisi. Entièrement hors ligne.
- **Placements financiers — cours en ligne** — se greffe sur la précédente
  (qu'elle exige) : un lien de page de cotation par titre, un bouton
  « Mettre à jour les cours » sur l'écran Placements, et une relecture au
  lancement de l'application. **Seule extension qui accède à Internet**, voir
  plus haut.

Pour en écrire une, voir [extensions/README.md](extensions/README.md).

## Développement

```bash
backend/.venv/bin/python -m uvicorn app.main:app --reload --app-dir backend
```

Puis <http://127.0.0.1:8000>.

Tests :

```bash
cd backend && .venv/bin/python -m pytest
```

## Licence

Usage personnel. Pas de licence d'exploitation accordée.
