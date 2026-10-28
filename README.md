# HelpDesk DevSecOps — Phases 0 et 1 (application volontairement vulnérable)

Projet académique — Module DevSecOps, TEK-UP University (ING-5-SSIR).
Binôme : **Ben Jemaa Roua** (backend, base de données, failles) · **Dkhil Mohamed Mahdi** (frontend, architecture, rapport).

> Cette branche (`phase-0-1`) ne contient **que** ce qui relève des phases 0 et 1 : l'application, sa base PostgreSQL, ses 4 failles volontaires et leurs preuves.
> Aucune faille n'est corrigée ici. Conteneurisation, CI/CD, correctifs, Kubernetes, DAST et observabilité viennent dans les phases suivantes.

## Démarrage

Prérequis : Node.js 20+, Docker.

```bash
# 1. Base PostgreSQL (schéma + données fictives chargés automatiquement)
bash scripts/start-db.sh
#    PowerShell : docker run -d --name helpdesk-db -e POSTGRES_DB=helpdesk -e POSTGRES_USER=helpdesk -e POSTGRES_PASSWORD=change_me_fictif_123 -p 5432:5432 -v "${PWD}/db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro" postgres:16-alpine

# 2. Backend (sert aussi l'interface)
cd backend
npm install
npm start

# 3. Ouvrir http://localhost:3000     (santé : http://localhost:3000/api/health)
```

Pour repartir d'une base propre : relancer `scripts/start-db.sh`.

## Comptes de test (données fictives, mot de passe `Passw0rd!`)

| Rôle | Identifiant | Usage |
|---|---|---|
| user | `roua`, `mahdi`, `charlie` | déclarer et suivre ses tickets, commenter |
| agent | `agent1` | voir tous les tickets, changer le statut, commenter |
| admin | `admin1` | gérer les comptes et rôles, journal d'audit |

## Les 4 failles volontaires

| N° | Faille | Emplacement | OWASP | Preuve |
|---|---|---|---|---|
| VULN-001 | Injection SQL | `GET /search?q=` (`backend/server.js`) | A03 | `' OR 1=1 --` renvoie tous les tickets |
| VULN-002 | XSS stocké | commentaires (`frontend/index.html`) | A03 | un commentaire HTML s'exécute chez l'agent |
| VULN-003 | IDOR | `GET /tickets/:id` | A01 | roua lit le ticket #3 de mahdi |
| VULN-004 | Secret JWT en dur | `VULNERABLE_JWT_SECRET` (`backend/server.js`) | A02 / A05 | visible dans le dépôt |
| Bonus | Dépendances obsolètes | `backend/package.json` | A06 | express 4.17.1, jsonwebtoken 8.5.1 |

Rejouer les preuves (à capturer pour le rapport) : `bash scripts/proofs.sh`.
Détails : `docs/failles.md`.

## Structure

```
backend/    API Express (server.js) + package.json
frontend/   index.html (interface)
db/         init.sql (schéma + données fictives)
docs/       architecture-initiale.md, failles.md, trame-rapport.md
k8s/        vide pour l'instant (phase 6)
scripts/    start-db.sh, proofs.sh
.env.example
```

## Retrouver le reste du projet

Tout le travail déjà fait est conservé dans l'historique Git :
- `master` : version avec pipeline GitHub Actions (phase 3) ;
- `secure` : version avec les failles corrigées (phase 5) ;
- commit `fa0e088` : jalon S1 complet avec Dockerfiles et Docker Compose (phase 2).

Pour récupérer par exemple la conteneurisation en phase 2 :
`git checkout fa0e088 -- docker-compose.yml backend/Dockerfile backend/.dockerignore frontend/Dockerfile frontend/nginx.conf .dockerignore`
