# Dossier des Vulnérabilités Volontaires et Correctifs — HelpDesk DevSecOps

**Projet :** HelpDesk — Plateforme de tickets d'incident  
**Module :** DevSecOps · ING-5-SSIR · TEK-UP University  
**Binôme :** Ben Jemaa Roua (Backend & Sécurité) & Dkhil Mohamed Mahdi (Frontend & DevOps)

---

## Synthèse Générale

| Identifiant | Vulnérabilité | OWASP Top 10 | STRIDE | Emplacement | Statut Pédagogique | Statut Sécurisé |
|---|---|---|---|---|---|---|
| **VULN-001** | Injection SQL (SQLi) | A03:2021 – Injection | Tampering, Information Disclosure | `GET /search?q=` dans `backend/server.js` | Démontré avec `' OR 1=1 --` | Requêtes paramétrées `$1` |
| **VULN-002** | Cross-Site Scripting (XSS) stocké | A03:2021 – Injection | Tampering | Affichage des commentaires dans `frontend/index.html` | Exécution de payload JavaScript | `textContent`, encodage entités & CSP |
| **VULN-003** | Insecure Direct Object Reference (IDOR) | A01:2021 – Broken Access Control | Information Disclosure, Elevation of Privilege | `GET /tickets/:id` dans `backend/server.js` | Roua lit le ticket #3 de Mahdi | Contrôle propriétaire ou rôle agent/admin |
| **VULN-004** | Secret JWT fictif exposé en clair | A02:2021 – Cryptographic Failures / A05:2021 – Security Misconfiguration | Information Disclosure | Constante `VULNERABLE_JWT_SECRET` dans `backend/server.js` | Détectable par Gitleaks | Injection par variable d'environnement & Secret K8s |
| **BONUS** | Dépendances vulnérables | A06:2021 – Vulnerable and Outdated Components | Tampering | `backend/package.json` | Versions initiales obsolètes | Analyse Trivy & mise à niveau |

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

### 1.4 Correctif Appliqué (Mode Sécurisé)
Remplacement de la concaténation brute par une requête paramétrée préparée par le pilote PostgreSQL :
```javascript
// Mode sécurisé
const sql = `
  SELECT t.id, t.title, t.description, t.status, t.priority, t.category, t.created_at,
         u.username AS owner_username
  FROM tickets t
  JOIN users u ON u.id = t.owner_id
  WHERE (t.owner_id = $1 OR $2 = true)
    AND (t.title ILIKE $3 OR t.description ILIKE $3)
  ORDER BY t.id
`;
const r = await pool.query(sql, [req.user.id, isAgentOrAdmin, `%${q}%`]);
```

### 1.5 Test Après Correction
En relançant la même requête avec `q=' OR 1=1 --`, le paramètre `$3` reçoit la chaîne littérale `%' OR 1=1 --%`. Le moteur SQL recherche un ticket dont le titre contient textuellement ces caractères. La tentative d'injection ne retourne aucun ticket non autorisé.

---

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

### 2.4 Correctif Appliqué (Mode Sécurisé)
1. **Frontend** : Utilisation stricte de `textContent` (ou `innerText`) pour traiter le contenu comme du texte brut :
```javascript
// Mode sécurisé
const bodyDiv = document.createElement('div');
bodyDiv.className = 'comment-body';
bodyDiv.textContent = c.body;
li.appendChild(bodyDiv);
```
2. **Backend** : Échappement des caractères HTML sensibles (`<`, `>`, `&`, `"`, `'`) avant persistance.
3. **En-têtes HTTP** : Envoi de l'en-tête `Content-Security-Policy` bloquant l'exécution de scripts en ligne non autorisés.

### 2.5 Test Après Correction
Le commentaire contenant `<img src=x onerror=...>` est affiché textuellement à l'écran sous la forme brute sans qu'aucune requête réseau vers l'image cassée ni aucun script JavaScript ne s'exécute.

---

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

### 3.4 Correctif Appliqué (Mode Sécurisé)
Vérification d'autorisation côté serveur :
```javascript
if (SECURITY_MODE === 'secure') {
  const isOwner = ticket.owner_id === req.user.id;
  const isStaff = req.user.role === 'agent' || req.user.role === 'admin';
  if (!isOwner && !isStaff) {
    await logAudit(req.user.id, req.user.username, 'IDOR_ATTEMPT_BLOCKED', `Tentative d'accès au ticket #${ticketId}`, req.ip);
    return res.status(403).json({ error: "Accès interdit : vous n'avez pas l'autorisation de consulter ce ticket." });
  }
}
```

### 3.5 Test Après Correction
En relançant la requête avec le jeton de Roua sur le ticket #3, l'API renvoie un code HTTP `403 Forbidden` et enregistre l'événement dans le journal d'audit `audit_log`. Seul Mahdi ou les membres du support (agents/administrateurs) peuvent y accéder.

---

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
const VULNERABLE_JWT_SECRET = 'hd_fake_8f3a9c1e7b2d4f60a5c9e1b37d82f4aa';
```

### 4.3 Scénario de Détection & Preuve Avant Correction
L'exécution de l'outil Gitleaks dans le pipeline CI/CD (prévu au jalon S2) identifie immédiatement la présence du faux secret et bloque le pipeline avec un code de sortie non nul.

### 4.4 Procédure de Rotation & Correctif (Mode Sécurisé)
1. **Remplacement immédiat du secret** : Injection du secret à l'exécution via la variable d'environnement `JWT_SECRET` (dans le `.env` local non versionné ou un Secret Kubernetes hors dépôt).
2. **Fonction de récupération dynamique** :
```javascript
function getJwtSecret() {
  if (SECURITY_MODE === 'secure') {
    return process.env.JWT_SECRET || 'secure_runtime_key_tekup_devsecops_2026';
  }
  return VULNERABLE_JWT_SECRET;
}
```
3. **Nettoyage de l'historique** : Purge des commits contenant le secret fictif et réexécution de Gitleaks pour confirmer l'absence de secret.

### 4.5 Test Après Correction
Gitleaks valide l'absence de tout secret dans le dépôt Git et le pipeline passe avec succès.

