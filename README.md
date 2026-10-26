# HelpDesk DevSecOps — Plateforme de Tickets d'Incident (Jalon S1)

[![Module](https://img.shields.io/badge/Module-DevSecOps-blue.svg)](https://tek-up.de/)
[![Formation](https://img.shields.io/badge/Formation-ING--5--SSIR-orange.svg)](https://tek-up.de/)
[![Université](https://img.shields.io/badge/Université-TEK--UP-red.svg)](https://tek-up.de/)
[![Mode](https://img.shields.io/badge/Mode-Double%20(Vulnérable%20%2F%20Sécurisé)-green.svg)](#)

> **Projet académique :** Module DevSecOps — TEK-UP University (Année 2026)  
> **Binôme :**  
> - **Ben Jemaa Roua** : Backend Express, PostgreSQL, failles initiales, correctifs, Dockerfile, pipeline CI/CD, rotation des secrets  
> - **Dkhil Mohamed Mahdi** : Frontend UI/UX, Docker Compose, architecture, kind, Trivy, Kubernetes, DAST, observabilité, réponse à incident  

---

## 1. Présentation de la Plateforme

**HelpDesk** est une application web 3-tiers conçue pour illustrer l'intégralité du cycle de vie sécurisé (**SecDevOps**) :
1. **Écrire & Modéliser** : Conception d'une application multi-rôles avec modèle de menace STRIDE et 4 vulnérabilités intentionnelles documentées.
2. **Construire & Durcir** : Conteneurisation minimale multi-stage sur Alpine Linux avec exécution sans privilèges root (`USER 10001`).
3. **Tester & Bloquer** : Pipeline CI/CD automatisé bloquant toute livraison non conforme (Semgrep, Gitleaks, Trivy, Tests unitaires).
4. **Déployer & Segmenter** : Déploiement sur Kubernetes local (`kind`) durci avec `securityContext` restrictif et `NetworkPolicy`.
5. **Observer & Réagir** : Supervision Prometheus/Loki/Grafana, détection d'attaque fictive et plan de réponse à incident.

---

## 2. Architecture Technique (Jalon S1)

```
                            [Poste Navigateur Web]
                                       │
                               HTTP sur :8080
                                       ▼
                  ┌────────────────────────────────────────┐
                  │          frontend (Nginx)              │
                  │  nginxinc/nginx-unprivileged:alpine    │
                  │  - Reverse Proxy sur /api/             │
                  │  - Interface Responsive SPA            │
                  └───────────────────┬────────────────────┘
                                      │ Proxy HTTP :3000
                                      ▼
                  ┌────────────────────────────────────────┐
                  │          backend (Node.js)             │
                  │  node:20-alpine (USER 10001:10001)     │
                  │  - Authentification JWT & RBAC         │
                  │  - Double mode : Vulnérable / Sécurisé │
                  │  - Journalisation JSON & Audit Log     │
                  └───────────────────┬────────────────────┘
                                      │ Pool PostgreSQL :5432
                                      ▼
                  ┌────────────────────────────────────────┐
                  │            db (PostgreSQL)             │
                  │  postgres:16-alpine (helpdesk-db)      │
                  │  - Users, Tickets, Comments            │
                  │  - Notifications, History, Audit       │
                  └────────────────────────────────────────┘
```

---

## 3. Démarrage Rapide

### Prérequis
- Docker et Docker Compose installés sur votre machine.

### Instructions de Lancement
```bash
# 1. Cloner ou ouvrir le dossier du projet
cd c:\projets\helpdesk

# 2. Préparer le fichier d'environnement local (données fictives)
cp .env.example .env

# 3. Construire et démarrer l'ensemble des conteneurs
docker compose up --build
```

L'application est immédiatement accessible sur : **`http://localhost:8080`**  
La sonde de santé de l'API est interrogeable sur : **`http://localhost:8080/api/health`**

---

## 4. Comptes de Test et Espaces Métier

Tous les comptes de démonstration utilisent le mot de passe fictif : **`Passw0rd!`**

| Rôle | Identifiant | Nom | Permissions & Espaces |
|---|---|---|---|
| **`user`** | `alice` | Alice Test | Déclaration de tickets, suivi de ses tickets personnels, commentaires, notifications personnelles. |
| **`user`** | `bob` | Bob Exemple | Deuxième utilisateur fictif (permet la démonstration de l'IDOR et de l'isolation des données). |
| **`user`** | `charlie` | Charlie Martin | Utilisateur ayant déclaré le ticket de sécurité (#5). |
| **`agent`** | `agent1` | Agent Un | File d'attente globale, filtrage des incidents critiques, changement de statut (`open` &rarr; `in_progress` &rarr; `closed`), commentaires de prise en charge. |
| **`admin`** | `admin1` | Administrateur IT | Métriques globales, création et désactivation de comptes utilisateurs, journal d'audit de sécurité, contrôle du mode de sécurité. |

> 💡 **Astuce Démo :** Sur la page de connexion, des boutons à 1-clic permettent de préremplir instantanément les identifiants pour Alice, Bob, Agent 1 et Admin 1.

---

## 5. Démonstration des 4 Vulnérabilités Pédagogiques

L'application intègre un **sélecteur de mode** (accessible via l'interface web ou la variable `SECURITY_MODE=vulnerable|secure`) permettant de prouver l'existence des failles puis la validité de leurs correctifs.

### Faille 1 — Injection SQL (A03 Injection)
- **Emplacement :** `GET /search?q=` dans `backend/server.js`
- **Scénario :** Connecté en `alice`, rechercher un ticket avec la charge utile `' OR 1=1 --`.
- **Preuve en ligne de commande :**
```bash
# 1. Connexion en tant qu'Alice
TOKEN=$(curl -s -X POST http://localhost:8080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"Passw0rd!"}' | sed 's/.*"token":"\([^"]*\)".*/\1/')

# 2. Recherche normale (ne retourne que les tickets d'Alice)
curl -s -G "http://localhost:8080/api/search" --data-urlencode "q=VPN" -H "Authorization: Bearer $TOKEN"

# 3. Injection SQL (retourne TOUS les tickets, y compris ceux de Bob)
curl -s -G "http://localhost:8080/api/search" --data-urlencode "q=' OR 1=1 --" -H "Authorization: Bearer $TOKEN"
```
- **Correction :** En basculant en mode sécurisé, la requête utilise un paramètre préparé `$3` avec `ILIKE` et neutralise l'injection.

---

### Faille 2 — XSS Stocké (A03 Injection)
- **Emplacement :** Fil de commentaires dans `frontend/index.html` et `backend/server.js`
- **Scénario :**
  1. Se connecter en `alice`, ouvrir le ticket #1 et ajouter le commentaire :
     ```html
     <img src=x onerror="alert('VULN-002: Stored XSS exécuté !')">
     ```
  2. Se connecter en `agent1` et consulter le ticket #1.
  3. En mode vulnérable, le script JavaScript s'exécute immédiatement dans le navigateur de l'agent.
- **Correction :** En mode sécurisé, le corps du commentaire est rendu via `textContent` (texte brut sécurisé), les balises sont échappées côté backend et l'en-tête CSP bloque les injections.

---

### Faille 3 — IDOR (A01 Broken Access Control)
- **Emplacement :** `GET /tickets/:id` dans `backend/server.js`
- **Scénario :** Alice (`id: 1`) tente d'accéder directement au ticket confidentiel #3 appartenant à Bob (`id: 2`).
- **Preuve en ligne de commande :**
```bash
# Alice consulte le ticket #3 appartenant à Bob
curl -i -s "http://localhost:8080/api/tickets/3" -H "Authorization: Bearer $TOKEN"
```
- **Résultat vulnérable :** HTTP `200 OK` avec exposition des données confidentielles de Bob.
- **Résultat sécurisé :** HTTP `403 Forbidden` (`"Accès interdit : vous n'avez pas l'autorisation de consulter ce ticket"`) et inscription d'une alerte dans `audit_log`.

---

### Faille 4 — Secret JWT Fictif Exposé (A02 / A05)
- **Emplacement :** Constante `VULNERABLE_JWT_SECRET = 'hd_fake_8f3a9c1e7b2d4f60a5c9e1b37d82f4aa'` dans `backend/server.js`.
- **Démonstration :** Détectable automatiquement lors du scan CI/CD par **Gitleaks** (jalon S2).
- **Correction :** Rotation du secret et chargement exclusif via la variable d'environnement `JWT_SECRET` ou un Secret Kubernetes hors dépôt.

---

## 6. Tests Automatisés et Non-Régression

Une suite de tests automatisée vérifie le bon fonctionnement de l'authentification, des permissions RBAC, et de la neutralisation des 4 failles :

```bash
# Exécution des tests unitaires backend
cd backend
npm test
```

Résultats attendus :
```
--- Démarrage de la suite de tests HelpDesk ---

[1] Tests Authentification & Chiffrement (Bcrypt / JWT) :
  ✔ Le mot de passe de test correspond au hash bcrypt
  ✔ Génération et vérification d'un jeton JWT pour les 3 rôles (user, agent, admin)

[2] Tests Contrôle d'Accès par Rôles (RBAC) :
  ✔ Validation des permissions pour les 3 rôles

[3] Tests Faille 3 (IDOR - Insecure Direct Object Reference) :
  ✔ En mode sécurisé, un utilisateur régulier ne peut pas accéder au ticket d'un tiers

[4] Tests Faille 2 (Stored XSS) :
  ✔ En mode sécurisé, les balises HTML script et img dangereuses sont échappées

[5] Tests Faille 1 (Injection SQL sur la recherche) :
  ✔ Validation de la séparation entre concaténation brute et paramétrage

========================================
Résultats : 7 réussis, 0 échoués
========================================
```

---

## 7. Structure des Livrables

```
helpdesk/
├── backend/
│   ├── Dockerfile             # Multi-stage build, USER 10001
│   ├── package.json           # Dépendances applicatives (Express, pg, bcryptjs, jwt)
│   ├── server.js              # API Express complète (RBAC, Audit, Notifications, 4 Failles)
│   ├── test.js                # Suite de tests unitaires et non-régression
│   └── .dockerignore          # Exclusion des fichiers sensibles
├── db/
│   └── init.sql               # Schéma relationnel (3 rôles, audit, notifs, history, seed)
├── frontend/
│   ├── Dockerfile             # Nginx unprivileged Alpine
│   ├── nginx.conf             # Reverse proxy API et règles SPA
│   └── index.html             # Interface moderne avec Landing page, 3 Dashboards, Lab
├── docs/
│   ├── architecture-initiale.md  # Description détaillée de l'architecture S1
│   ├── failles.md             # Dossier technique complet des 4 vulnérabilités
│   └── trame-rapport.md       # Trame du rapport académique (6 à 10 pages)
├── docker-compose.yml         # Orchestration des services db, backend, frontend
├── .env.example               # Modèle des variables d'environnement
├── .gitignore                 # Exclusion des secrets et modules
└── README.md                  # Documentation principale
```

---

## 8. Préparation pour le Jalon S2 (CI/CD)

Le travail réalisé en S1 pose les bases pour les étapes suivantes :
- **S2** : Configuration du pipeline `.gitlab-ci.yml` avec contrôles bloquants (Gitleaks, Semgrep, Trivy).
- **S3** : Déploiement Kubernetes local (`kind`), NetworkPolicies et durcissement `securityContext`.
- **S4** : Scans dynamiques DAST OWASP ZAP, observabilité Loki/Grafana et rédaction du rapport final.
