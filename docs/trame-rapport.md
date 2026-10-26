# Trame Détaillée du Rapport de Sécurité DevSecOps (6 à 10 pages)

**Projet :** HelpDesk — Plateforme de gestion de tickets d'incident  
**Module :** DevSecOps · ING-5-SSIR · TEK-UP University  
**Binôme :** Ben Jemaa Roua (Sections 1 à 7) & Dkhil Mohamed Mahdi (Sections 8 à 12)

---

## Sommaire Prévisionnel

### 1. Présentation de HelpDesk et Périmètre du Projet (0,5 page)
- Contexte académique TEK-UP University (ING-5-SSIR).
- Définition du besoin : plateforme de tickets d'incident 3-tiers (HTML, Express, PostgreSQL).
- Présentation des trois rôles : `user`, `agent`, `admin`.
- Données strictement fictives (adresses IP internes 10.20.*.*, numéros de série SN-*).
- Périmètre impératif : environnement de laboratoire contrôlé.

### 2. Architecture Finale Commentée et Cartographie des Flux (1 page)
- Schéma d'architecture détaillé en 8 étapes (du code à la production).
- Description des composants (Frontend Nginx, Backend Express, PostgreSQL 16).
- Flux réseau et segmentation (Utilisateur &rarr; Frontend &rarr; Backend &rarr; Base de données).
- Rôle du registre d'images, du runner auto-hébergé et de Kubernetes local.

### 3. Modèle de Menace STRIDE et Correspondance OWASP Top 10 (1 page)
- Matrice STRIDE croisée avec les 4 composants de l'application (Frontend, Backend, DB, Pipeline).
- Correspondance détaillée avec l'OWASP Top 10 (A01, A02, A03, A05, A06, A07, A09).
- Analyse d'impact sur la confidentialité, l'intégrité et la disponibilité.

### 4. Dossier des Failles Volontaires Initiales (2 pages)
- **Faille 1 (SQLi)** : `GET /search?q=` — payload `' OR 1=1 --`, cause (concaténation), preuve d'extraction.
- **Faille 2 (XSS Stocké)** : Commentaires — payload `<img src=x onerror=...>`, cause (affichage sans échappement).
- **Faille 3 (IDOR)** : `GET /tickets/:id` — accès direct au ticket #3 de Bob par Alice sans vérification.
- **Faille 4 (Secret Exposé)** : Constante `JWT_SECRET` dans `backend/server.js`, détection par Gitleaks.
- **Bonus** : Dépendances vulnérables identifiées par Trivy.
- Correctifs techniques appliqués pour chaque faille et tests de validation.

### 5. Conteneurisation et Durcissement (0,5 page)
- Dockerfile multi-stage sur image minimale Alpine.
- Exécution obligatoire sans privilèges root (`USER 10001:10001`).
- Fichier `.dockerignore` prévenant l'embarquement de secrets ou de `.git`.
- Scan Trivy de l'image de conteneur.

### 6. Pipeline CI/CD et Sécurité Bloquante (1 page)
- Étapes du pipeline GitLab CI : build, tests unitaires, Semgrep (SAST), Gitleaks, Trivy (dépendances et image), push, deploy, DAST.
- Politique de blocage stricte : conditions de refus et justifications techniques.
- Preuve de blocage sur secret exposé puis preuve de validation après assainissement.

### 7. Gestion et Procédure de Rotation des Secrets (0,5 page)
- Injection des secrets à l'exécution via variables protégées GitLab et Secrets Kubernetes.
- Procédure de rotation en 4 étapes : 1) Révocation/remplacement, 2) Déploiement de la nouvelle clé, 3) Purge de l'historique Git, 4) Vérification Gitleaks.

### 8. Déploiement Kubernetes et Durcissement (1 page)
- Déploiement sur cluster local (kind / Minikube).
- Configuration restrictive du `securityContext` (`runAsNonRoot: true`, `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, capabilities dropped, seccomp).
- Segmentation réseau par NetworkPolicies (refus par défaut, ouvertures ciblées).

### 9. Tests Dynamiques de Sécurité (DAST - OWASP ZAP) (1 page)
- Méthodologie d'analyse dynamique sur l'instance de test locale.
- Résultats du scan ZAP avant correction (confirmation dynamique de SQLi et XSS).
- Résultats du scan ZAP après correction et analyse comparative.

### 10. Observabilité et Plan de Réponse à Incident (1 page)
- Journaux applicatifs structurés JSON (sans secrets ni mots de passe).
- Collecte et tableaux de bord avec Prometheus, Grafana et Loki.
- Démonstration de l'attaque fictive visible dans Loki avec alerte Grafana.
- Plan de réponse à incident en 5 phases : Détecter, Contenir, Éradiquer, Rétablir, Retour d'expérience.

### 11. Limites, Usage Déclaré de l'IA et Références (0,5 page)
- Limites du pipeline CI/CD et des scores d'analyse statique.
- Déclaration de l'usage responsable de l'assistance d'ingénierie logicielle.
- Références normatives (OWASP, CIS Benchmarks, NIST, Kubernetes Security).
