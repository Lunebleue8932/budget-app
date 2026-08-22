# Budget App

Gestionnaire de budget personnel, **entièrement hors ligne**. Suivi des comptes
et des opérations, import de relevés bancaires (Excel/CSV), budgets par
catégorie, virements internes, prêts et remboursements, amortissement des
grosses dépenses, et suivi multi-devises sans jamais mélanger deux monnaies.

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
3. relance l'application : elle te confirme l'avoir trouvée.

```
Budget App/
  Budget App.exe        (ou « Budget App » sous Linux, « Budget App.app » sous macOS)
  data/                 ta base de données
  extensions/
    placements/         <- le dossier décompressé
```

Une extension s'active et se désactive ensuite depuis **Paramètres →
Extensions**, sans redémarrer. **Désactiver ne supprime jamais de données** :
l'écran disparaît, les routes se ferment, et tout réapparaît intact à la
réactivation.

### Disponibles

- **Placements financiers** — portefeuille de titres, achats/ventes,
  valorisation au dernier cours saisi.

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
