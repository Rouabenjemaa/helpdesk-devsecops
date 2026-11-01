# Dossier des Vulnérabilités Volontaires — HelpDesk DevSecOps (phases 0-1)

**Projet :** HelpDesk — Plateforme de tickets d'incident  
**Module :** DevSecOps · ING-5-SSIR · TEK-UP University  
**Binôme :** Ben Jemaa Roua (Backend & Sécurité) & Dkhil Mohamed Mahdi (Frontend & DevOps)

---

## Synthèse Générale

| Identifiant | Vulnérabilité | OWASP Top 10 | STRIDE | Emplacement | Statut Pédagogique |
|---|---|---|---|---|---|
| **VULN-001** | Injection SQL (SQLi) | A03:2021 – Injection | Tampering, Information Disclosure | `GET /search?q=` dans `backend/server.js` | Démontré avec `' OR 1=1 --` |
| **VULN-002** | Cross-Site Scripting (XSS) stocké | A03:2021 – Injection | Tampering | Affichage des commentaires dans `frontend/index.html` | Exécution de payload JavaScript |
| **VULN-003** | Insecure Direct Object Reference (IDOR) | A01:2021 – Broken Access Control | Information Disclosure, Elevation of Privilege | `GET /tickets/:id` dans `backend/server.js` | Roua lit le ticket #3 de Mahdi |
| **VULN-004** | Secret JWT fictif exposé en clair | A02:2021 – Cryptographic Failures / A05:2021 – Security Misconfiguration | Information Disclosure | Constante `VULNERABLE_JWT_SECRET` dans `backend/server.js` | Détectable par Gitleaks |
| **BONUS** | Dépendances vulnérables | A06:2021 – Vulnerable and Outdated Components | Tampering | `backend/package.json` | Versions initiales obsolètes |

---

## 1. VULN-001 — Injection SQL (SQLi)

### 1.1 Fiche Technique
- **Identifiant :** VULN-001
- **Nom :** Injection SQL dans la recherche de tickets
- **Fichier et Fonction :** `backend/server.js` — Route `app.get('/search', ...)`
- **Catégorie OWASP :** A03:2021 – Injection
- **Catégorie STRIDE :** Tampering, Information Disclosure
- **Impact :** Un utilisateur restreint peut contourner le filtre de propriété et extraire la totalité des tickets de tous les utilisateurs de l'organisation.

### 1.2 Cause Technique
En mode vulnérable, la valeur du paramètre de requête `q` est concaténée directement par interpolation de chaîne dans la clause SQL `WHERE` :
```javascript
// Mode vulnérable (reproduction lab)
const scope = req.user.role === 'agent' ? 'TRUE' : 't.owner_id=' + Number(req.user.id);
const sql = `SELECT ... FROM tickets t WHERE ${scope} AND t.title ILIKE '%${q}%' ORDER BY t.id`;
```

### 1.3 Scénario de Test & Preuve Avant Correction
1. Authentification en tant qu'utilisateur standard (`roua`).
2. Requête normale :
```bash
curl -s -G "http://localhost:8080/api/search" --data-urlencode "q=VPN" \
  -H "Authorization: Bearer $ROUA_TOKEN"
# Résultat : retourne uniquement le ticket VPN de Roua (#2).
```
3. Injection de la charge utile `' OR 1=1 --` :
```bash
curl -s -G "http://localhost:8080/api/search" --data-urlencode "q=' OR 1=1 --" \
  -H "Authorization: Bearer $ROUA_TOKEN"
# Résultat : la clause "1=1" rend la condition universellement vraie et le commentaire "--" neutralise la suite.
# Roua récupère TOUS les tickets de la base, y compris le ticket RH confidentiel de Mahdi (#3).
```

### 1.4 Correctif
À réaliser plus tard (phase 5 ; rotation du secret en phase 4). Non implémenté en phase 1 : l'application reste volontairement vulnérable.

## 2. VULN-002 — Cross-Site Scripting (XSS) Stocké

### 2.1 Fiche Technique
- **Identifiant :** VULN-002
- **Nom :** XSS Stocké dans les commentaires d'incident
- **Fichier et Fonction :** `frontend/index.html` (`loadTicketDetail`) et `backend/server.js` (`POST /tickets/:id/comments`)
- **Catégorie OWASP :** A03:2021 – Injection
- **Catégorie STRIDE :** Tampering
- **Impact :** Un attaquant peut injecter du code JavaScript malveillant dans un commentaire. Lorsqu'un agent ou un administrateur consulte le ticket, le script s'exécute dans son navigateur (vol de jeton, actions frauduleuses).

### 2.2 Cause Technique
En mode vulnérable, le corps du commentaire est inséré directement dans l'arbre DOM via la propriété `innerHTML` sans neutralisation des balises HTML :
```javascript
// Mode vulnérable
li.innerHTML = headerHtml + `<div class="comment-body">${c.body}</div>`;
```

### 2.3 Scénario de Test & Preuve Avant Correction
1. Connecté en `roua`, ouvrir un ticket et ajouter le commentaire suivant :
```html
<img src=x onerror="alert('VULN-002: Stored XSS exécuté !')">
```
2. Se déconnecter et se connecter en tant qu'agent (`agent1`).
3. Ouvrir le ticket en question : la boîte de dialogue d'alerte JavaScript s'affiche immédiatement dans la session de l'agent.

### 2.4 Correctif
À réaliser plus tard (phase 5 ; rotation du secret en phase 4). Non implémenté en phase 1 : l'application reste volontairement vulnérable.

## 3. VULN-003 — Insecure Direct Object Reference (IDOR)

### 3.1 Fiche Technique
- **Identifiant :** VULN-003
- **Nom :** Contrôle d'accès défaillant sur le détail des tickets
- **Fichier et Fonction :** `backend/server.js` — Route `app.get('/tickets/:id', ...)`
- **Catégorie OWASP :** A01:2021 – Broken Access Control
- **Catégorie STRIDE :** Information Disclosure, Elevation of Privilege
- **Impact :** N'importe quel utilisateur authentifié peut consulter les détails confidentiels, commentaires et historiques de tickets appartenant à d'autres utilisateurs par simple incrémentation de l'identifiant.

### 3.2 Cause Technique
L'API vérifiait la validité du jeton JWT (`auth`), mais n'effectuait aucune vérification de propriété entre l'identifiant de l'utilisateur connecté (`req.user.id`) et le champ `owner_id` du ticket demandé.

### 3.3 Scénario de Test & Preuve Avant Correction
1. Roua (`id: 1`) s'authentifie et obtient un jeton JWT.
2. Mahdi (`id: 2`) possède le ticket `#3` ("Accès dossier RH confidentiel refusé").
3. Roua tente d'accéder au ticket de Mahdi :
```bash
curl -s "http://localhost:8080/api/tickets/3" -H "Authorization: Bearer $ROUA_TOKEN"
# Résultat : l'API renvoie le ticket #3 complet avec ses commentaires et son historique confidentiel.
```

### 3.4 Correctif
À réaliser plus tard (phase 5 ; rotation du secret en phase 4). Non implémenté en phase 1 : l'application reste volontairement vulnérable.

## 4. VULN-004 — Secret JWT Fictif Exposé dans le Code

### 4.1 Fiche Technique
- **Identifiant :** VULN-004
- **Nom :** Faux secret cryptographique codé en dur dans le dépôt Git
- **Fichier et Fonction :** `backend/server.js` — Variable `VULNERABLE_JWT_SECRET`
- **Catégorie OWASP :** A02:2021 – Cryptographic Failures / A05:2021 – Security Misconfiguration
- **Catégorie STRIDE :** Information Disclosure, Spoofing
- **Impact :** Un attaquant ayant accès au code source ou à l'historique Git peut forger arbitrairement des jetons JWT valides et usurper n'importe quel rôle (notamment `admin`).

### 4.2 Cause Technique
Le secret utilisé pour signer et valider les jetons JWT était codé sous forme de constante textuelle dans le code applicatif :
```javascript
const VULNERABLE_JWT_SECRET = '<valeur fictive retirée de la documentation>';
```

### 4.3 Scénario de Détection & Preuve Avant Correction
L'exécution de l'outil Gitleaks dans le pipeline CI/CD (prévu au jalon S2) identifie immédiatement la présence du faux secret et bloque le pipeline avec un code de sortie non nul.

### 4.4 Correctif (phase 4)
Le secret est lu depuis `process.env.JWT_SECRET` (32 caractères minimum, aucune valeur par défaut). Il est fourni par le fichier `.env` en local, par les variables protégées GitHub dans la CI et par un Secret Kubernetes dans le cluster. L'ancien secret est révoqué (rotation), et les jetons signés avec lui sont refusés. Procédure complète : `docs/secrets-phase4.md`.
