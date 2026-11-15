# HelpDesk DevSecOps — Phases 0 à 8

Projet académique — Module DevSecOps, TEK-UP University (ING-5-SSIR).
Binôme : **Ben Jemaa Roua** (backend, base de données, failles) · **Dkhil Mohamed Mahdi** (frontend, architecture, rapport).

> Phases réalisées : 0–1 application et failles de démonstration, 2 conteneurisation, 3 pipeline CI, 4 gestion des secrets, 5 corrections, 6 Kubernetes, 7 scans OWASP ZAP et 8 observabilité.

## Démarrage

Prérequis : Node.js 20+, Docker.

Pour Docker Compose, commencez par copier `.env.example` vers `.env` et remplacez les valeurs `EXAMPLE_ONLY_*` par des valeurs locales. Compose échoue si les paramètres PostgreSQL sont absents. `ENABLE_DEMO_SEED=true` active les comptes de démonstration en développement; laissez-le à `false` en production. Le seed ne change jamais les comptes existants. Le schéma seul ne crée aucun compte.

```powershell
# Démarrage manuel, depuis PowerShell (le mot de passe est saisi sans écho).
$env:POSTGRES_DB = 'helpdesk'
$env:POSTGRES_USER = 'helpdesk'
$secure = Read-Host 'Mot de passe PostgreSQL local' -AsSecureString
$env:POSTGRES_PASSWORD = [Net.NetworkCredential]::new('', $secure).Password
bash scripts/start-db.sh

# 2. Backend : transmettre explicitement les variables requises.
cd backend
$env:DB_HOST = 'localhost'
$env:DB_PORT = '5432'
$env:DB_NAME = $env:POSTGRES_DB
$env:DB_USER = $env:POSTGRES_USER
$env:DB_PASSWORD = $env:POSTGRES_PASSWORD
$env:JWT_SECRET = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:ENABLE_DEMO_SEED = 'true'
npm ci
npm start

# 3. Ouvrir http://localhost:3000     (santé : http://localhost:3000/api/health)
```

Le script ne supprime jamais de conteneur et utilise le volume Docker `helpdesk-db-local-data`. S'il existe déjà un conteneur `helpdesk-db-local`, inspectez-le et sauvegardez ses données avant toute opération. Pour une nouvelle base Compose, les données du volume local ne sont pas migrées automatiquement.
Après avoir arrêté le backend, effacez les variables sensibles de la session PowerShell si elle reste ouverte : `Remove-Item Env:POSTGRES_PASSWORD, Env:DB_PASSWORD, Env:JWT_SECRET`.

## Phase 2 : tout lancer avec Docker Compose

Arrêtez d'abord le backend lancé à la main (Ctrl+C). Compose utilise sa propre base et son propre volume; aucune donnée de la base locale n'est transférée automatiquement.

```powershell
docker compose up --build -d
docker compose ps
```

Interface : **http://localhost:8080** (nginx -> `/api/` -> backend -> PostgreSQL). Le port 3000 du backend n'est pas exposé en dehors du réseau Docker.

Preuve « sans root » (à capturer) :

```powershell
docker exec helpdesk-backend whoami      # doit afficher : app   (jamais root)
docker exec helpdesk-backend id          # uid=10001(app) gid=10001(app)
docker exec helpdesk-frontend whoami     # nginx (image nginx-unprivileged)
```

Arrêter les services sans supprimer les données : `docker compose down`. **N'ajoutez pas `-v` sauf si vous voulez supprimer définitivement le volume et les données PostgreSQL.**
Les vérifications de sécurité locales (`scripts/proofs.sh`) s'utilisent avec `API=http://localhost:8080/api bash scripts/proofs.sh`.

## Phase 4 : secret JWT (obligatoire pour démarrer)

Le secret n'est plus dans le code. Générez-le et ajoutez-le à votre fichier `.env` :

```powershell
$s = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Add-Content -Path .env -Value "`nJWT_SECRET=$s"
docker compose up --build -d
```

Pour lancer le backend à la main : `$env:JWT_SECRET = "<valeur>"` avant `npm start`.
Détails, GitHub Secrets, Secret Kubernetes et rotation : `docs/secrets-phase4.md`.
Pour activer le seed local : `$env:ENABLE_DEMO_SEED = "true"`. En production, `NODE_ENV=production` désactive le seed par défaut et interdit son activation.

Pour le lancement manuel, les variables `DB_USER` et `DB_PASSWORD` sont obligatoires et doivent être définies dans le même environnement que `npm start`; Node ne charge pas `.env` automatiquement.

## Phase 5 : failles corrigées

Les 4 failles sont corrigées et couvertes par des tests de non-régression (`backend/test/regression.test.js`).
Détails, limites connues et mise à jour des dépendances : `docs/correctifs-phase5.md`.

## Comptes de test (seed de développement uniquement, mot de passe `Passw0rd!`)

Ces comptes ne sont créés que lorsque le seed est activé hors production. Ils ne sont pas initialisés par le schéma SQL ni dans Kubernetes.

| Rôle | Identifiant | Usage |
|---|---|---|
| user | `roua`, `mahdi`, `charlie` | déclarer et suivre ses tickets, commenter |
| agent | `agent1` | voir tous les tickets, changer le statut, commenter |
| admin | `admin1` | gérer les comptes et rôles, journal d'audit |

## Failles de démonstration : état historique et corrections

Les vulnérabilités ci-dessous décrivent la version pédagogique des phases 0–1. Elles ont été corrigées ensuite : les payloads cités ne doivent pas être interprétés comme le comportement attendu de la version actuelle.

| N° | Faille initiale | Emplacement initial | Correction actuelle |
|---|---|---|---|
| VULN-001 | Injection SQL | Recherche `GET /search?q=` (`backend/server.js`) | Requête paramétrée, limites et filtrage par autorisation |
| VULN-002 | XSS stocké | Affichage des commentaires (anciennement dans `frontend/index.html`) | Texte échappé au rendu dans `frontend/app.js`, avec CSP |
| VULN-003 | IDOR | Lecture `GET /tickets/:id` (`backend/server.js`) | Vérification de propriété du ticket pour le rôle `user` |
| VULN-004 | Secret JWT codé en dur | Ancienne constante dans `backend/server.js` | `JWT_SECRET` obligatoire via l'environnement; aucune valeur par défaut |

Les contrôles après correction sont décrits dans `docs/correctifs-phase5.md` et couverts par `backend/test/regression.test.js`. `scripts/proofs.sh` envoie les payloads de démonstration; les tests de non-régression vérifient les résultats attendus sur la version corrigée : la recherche ne doit pas exposer les tickets d'autrui, l'IDOR doit être refusé et le commentaire HTML doit rester du texte. Les étapes historiques et leurs preuves sont décrites dans `docs/failles.md`.

## Structure

```
backend/    API Express (server.js), package.json, Dockerfile multi-étapes
frontend/   index.html, Dockerfile (nginx non privilégié), nginx.conf
docker-compose.yml   (db + backend + frontend)
db/         init.sql (schéma + données fictives)
docs/       guides des phases 3–8, architecture, failles historiques, preuves et trame du rapport
k8s/        cluster kind, manifestes et scripts de déploiement (phases 6 et 8)
zap/        scripts et spécifications des scans OWASP ZAP (phase 7)
scripts/    start-db.sh, proofs.sh
.env.example
```

## Phases et documentation

La branche `main` est la branche principale intégrée; `dev` sert au développement et aux intégrations avant `main`. `master` est une ancienne branche, pas la branche principale actuelle.

- Phases 0–1, architecture et vulnérabilités de démonstration : [architecture](docs/architecture-initiale.md) et [failles historiques](docs/failles.md)
- Phase 2, Docker Compose : instructions de démarrage ci-dessus et configuration dans `docker-compose.yml`
- Phase 3, CI/CD : [description du pipeline](docs/pipeline-phase3.md) et configuration active dans `.github/workflows/ci.yml` (tests, Gitleaks, Semgrep, Trivy dépendances, build/scan Docker; publication GHCR uniquement après un push sur `main`)
- Phase 4, secrets : [gestion, rotation et déploiements](docs/secrets-phase4.md)
- Phase 5, corrections : [correctifs et limites connues](docs/correctifs-phase5.md)
- Phase 6, Kubernetes : [guide et vérifications](docs/phase6-kubernetes.md)
- Phase 7, OWASP ZAP : [comparaison avant/après](docs/phase7-zap.md) et [preuves](docs/preuves/phase7/comparaison.md)
- Phase 8, observabilité : [architecture et procédures](docs/phase8-observabilite.md) et [preuves](docs/preuves/phase8/README.md)

### Premier administrateur Kubernetes

En production, aucun compte de démonstration n'est créé. Pour une base Kubernetes neuve, appliquer le schéma puis ouvrir un port-forward dans un terminal :

```powershell
kubectl port-forward -n helpdesk svc/db 5433:5432
```

Dans un second terminal PowerShell, depuis `backend`, charger le mot de passe DB depuis le Secret sans l'afficher, puis saisir le mot de passe initial de l'administrateur via une invite masquée :

```powershell
npm ci
$encoded = kubectl get secret helpdesk-db -n helpdesk -o jsonpath="{.data.POSTGRES_PASSWORD}"
$env:DB_HOST = '127.0.0.1'; $env:DB_PORT = '5433'; $env:DB_NAME = 'helpdesk'; $env:DB_USER = 'helpdesk'
$env:DB_PASSWORD = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
$env:BOOTSTRAP_ADMIN_USERNAME = Read-Host 'Identifiant administrateur initial'
$secure = Read-Host 'Mot de passe administrateur initial (12 caractères minimum)' -AsSecureString
$env:BOOTSTRAP_ADMIN_PASSWORD = [Net.NetworkCredential]::new('', $secure).Password
npm run bootstrap-admin
Remove-Item Env:DB_PASSWORD, Env:BOOTSTRAP_ADMIN_PASSWORD, Env:BOOTSTRAP_ADMIN_USERNAME, Env:DB_HOST, Env:DB_PORT, Env:DB_NAME, Env:DB_USER
Remove-Variable encoded, secure
```

Le script [bootstrap-admin.js](backend/bootstrap-admin.js) ne fonctionne que si `users` est vide; il ne modifie ni ne promeut un compte existant. Si un compte existe déjà, utilisez l'administrateur existant; si aucun administrateur n'existe, passez par une procédure de récupération DBA approuvée.

## Corrections sécurité de cette branche

Le seed ne réinitialise aucun mot de passe et est désactivé en production. PostgreSQL exige des identifiants explicites dans Compose. Les rôles et états actifs des comptes sont revérifiés en base sur les routes authentifiées, ce qui invalide immédiatement les JWT après rétrogradation ou désactivation, au coût d'une requête DB par requête authentifiée. Les styles et scripts principaux sont servis depuis `frontend/styles.css` et `frontend/app.js`; les attributs `style` et gestionnaires `onclick` encore présents imposent toutefois de conserver `unsafe-inline` dans la CSP jusqu'à leur migration complète. Trivy bloque les vulnérabilités HIGH/CRITICAL détectées lorsqu'un correctif est disponible (`ignore-unfixed: true`); les vulnérabilités sans correctif ne bloquent pas le pipeline.
