# Phase 7 : tests dynamiques avec OWASP ZAP (DAST)

**But :** attaquer l'application **en fonctionnement**, comme un pirate, avant puis après les corrections, et comparer. Semgrep lit le code, ZAP interroge l'application de l'extérieur.

> **Périmètre impératif :** on ne scanne que nos propres instances locales. Les scripts refusent toute autre cible.

## Ce qui est comparé

| | Version AVANT | Version APRÈS |
|---|---|---|
| Code | commit `10be198` (4 failles, conteneurs) | version corrigée (phases 4 et 5) |
| Où elle tourne | Docker Compose, **http://localhost:8090** | cluster `kind`, **http://localhost:8081** |
| Lancement | `zap\scripts\run-before.ps1` | déjà déployée (phase 6) |

Chaque version subit deux scans :
- **baseline** (passif) : explore le site et vérifie les en-têtes de sécurité ;
- **api** (**actif**) : ZAP envoie des charges d'attaque (injections, etc.) à chaque route décrite dans `zap/openapi.template.json`, avec le jeton de connexion de l'utilisateur `roua` (aucun privilège).

## Prérequis
- Docker Desktop démarré. L'image de ZAP (`zaproxy/zap-stable`) est volumineuse : le premier lancement est long. Si elle est introuvable, remplacez-la par `ghcr.io/zaproxy/zaproxy:stable` dans `zap\scripts\zap-scan.ps1`.
- Pour la version APRÈS : le cluster `kind` et l'application doivent tourner (`kubectl get pods -n helpdesk`).
- Le commit `10be198` doit exister dans votre clone (`git cat-file -t 10be198` doit répondre `commit`).

## Déroulement

**1. Lancer la version AVANT** (sans toucher à votre dossier de travail ni au cluster) :
```powershell
powershell -ExecutionPolicy Bypass -File zap\scripts\run-before.ps1
```
Ouvrez http://localhost:8090 pour vérifier. **Capture 1** : l'application AVANT.

**2. Scanner la version AVANT** (10 à 40 minutes, laissez tourner) :
```powershell
powershell -ExecutionPolicy Bypass -File zap\scripts\scan-before.ps1
```

**3. Scanner la version APRÈS** (cluster) :
```powershell
powershell -ExecutionPolicy Bypass -File zap\scripts\scan-after.ps1
```
ZAP rejoint le réseau Docker de `kind` et attaque le NodePort du nœud.

**4. Comparer :**
```powershell
powershell -ExecutionPolicy Bypass -File zap\scripts\compare.ps1
```
Le tableau (alertes corrigées, présentes, nouvelles) est écrit dans `docs\preuves\phase7\comparaison.md`.

**5. Nettoyer** la version AVANT quand vous avez fini : `powershell -ExecutionPolicy Bypass -File zap\scripts\stop-before.ps1`.

## Ce qu'il faut garder pour le rapport
Dans `docs\preuves\phase7\` : les rapports HTML (`baseline-before`, `api-before`, `baseline-after`, `api-after`) et `comparaison.md`. Faites aussi une capture du tableau affiché par `compare.ps1` et de la page de résumé d'un rapport HTML AVANT (alertes en rouge) à côté de la même page APRÈS.

## Ce que l'on peut attendre (à vérifier, ce n'est pas garanti)
- **Injection SQL (`/search`)** : probablement signalée AVANT (la version vulnérable renvoie des messages d'erreur SQL, que ZAP sait repérer) et absente APRÈS.
- **En-têtes de sécurité** : AVANT, ZAP signale sans doute l'absence de `Content-Security-Policy`, de `X-Content-Type-Options` et de protection contre le clickjacking. APRÈS, ces alertes devraient disparaître (en-têtes ajoutés en phase 5).
- **Divulgation d'informations** : AVANT, messages d'erreur détaillés et en-tête `X-Powered-By`. APRÈS, supprimés.
- **XSS stocké : ZAP ne le détectera très probablement pas.** Le commentaire piégé est envoyé dans un corps JSON, stocké, puis affiché par le navigateur : ZAP cherche surtout les XSS réfléchis dans des pages HTML. C'est une limite connue du DAST sur une application monopage. La preuve du XSS, c'est la capture manuelle (phase 1), le test de non-régression et la CSP. À écrire tel quel dans le rapport.
- **IDOR** : non détectable automatiquement non plus (ZAP ne sait pas qu'un ticket « appartient » à un autre utilisateur).

## Comprendre les résultats APRÈS
- Le limiteur de débit (phase 5) renvoie `429` après 60 recherches par minute : pendant le scan actif, une partie des requêtes de ZAP est donc refusée. C'est la protection qui travaille, mais cela réduit la couverture de `/search`. À mentionner dans le rapport.
- Une alerte **NOUVELLE** (présente seulement APRÈS) n'est pas forcément un problème : lisez-la dans le rapport HTML avant de conclure.
- Toute alerte restante APRÈS doit être expliquée (corrigée plus tard, ou faux positif).

## Dépannage
| Symptôme | Que faire |
|---|---|
| `run-before.ps1` : commit introuvable | `git fetch --all` puis `git cat-file -t 10be198`. |
| L'API AVANT ne répond pas sur 8090 | `docker compose -p helpdesk-before logs` ; le port 8090 est-il libre ? |
| ZAP ne joint pas la cible APRÈS | Le réseau Docker `kind` existe-t-il ? (`docker network ls`). Le cluster tourne-t-il ? |
| « Connexion impossible » (jeton) | L'application répond-elle sur le port indiqué ? Le compte `roua` existe-t-il ? |
| Un rapport n'est pas produit | Lisez les dernières lignes affichées par ZAP : une erreur de configuration y est signalée. |
| Le scan est très long | Normal pour un scan actif ; ne l'interrompez pas. |
