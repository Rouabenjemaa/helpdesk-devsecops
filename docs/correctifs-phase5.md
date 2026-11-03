# Correction des failles (phase 5)

Chaque faille de la phase 1 est corrigée et protégée par un test de non-régression (`backend/test/regression.test.js`) exécuté par le pipeline.

| Faille | Cause | Correctif | Test de non-régression |
|---|---|---|---|
| **VULN-001** Injection SQL (`GET /search`) | La saisie `q` était concaténée dans la requête SQL | Requête paramétrée (`ILIKE $1`), jokers `%` et `_` échappés, longueur limitée, erreur SQL jamais renvoyée au client | Le payload `' OR 1=1 --` ne renvoie aucun ticket d'un autre utilisateur ; aucune erreur SQL exposée |
| **VULN-002** XSS stocké (commentaires) | Le corps du commentaire était injecté avec `innerHTML` | Affichage avec `textContent` ; toutes les autres valeurs dynamiques passent par `escapeHtml` ; en-tête `Content-Security-Policy` (backend et nginx) | Le code ne contient plus `innerHTML` avec `c.body` ; l'API envoie la CSP et `nosniff` |
| **VULN-003** IDOR (`GET /tickets/:id`) | Aucun contrôle du propriétaire | Un `user` ne lit que ses tickets (403 sinon, tentative inscrite dans le journal d'audit) ; agents et admin inchangés | Roua reçoit 403 sur le ticket de Mahdi ; Mahdi et l'agent y accèdent |
| **VULN-004** Secret en dur | Secret JWT écrit dans `server.js` | Corrigée en phase 4 (variable d'environnement obligatoire) | Aucun `hd_fake_...` dans le code ; le serveur refuse de démarrer sans secret valide |

## Durcissements ajoutés
- Limitation de débit en mémoire : `/login` (10 par minute et par adresse) et `/search` (60 par minute). Derrière nginx, `TRUST_PROXY=1` permet de lire la vraie adresse client.
- JWT : algorithme imposé (`HS256`) à la signature et à la vérification.
- Les erreurs internes ne renvoient plus le message technique au client (`/health` comprise) ; elles sont écrites dans les journaux.
- Validation des types et longueurs (titre, description, commentaire).
- En-têtes `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
- Image Docker : `npm` et `yarn` retirés de l'image finale, ce qui supprime la copie vulnérable de `tar`.

## Limites connues (à écrire dans le rapport)
- La CSP garde `'unsafe-inline'` pour `script-src` : le frontend contient un script et des gestionnaires `onclick` en ligne. L'encodage à l'affichage reste donc la protection principale contre le XSS. Pour retirer `'unsafe-inline'`, il faudrait déplacer le script dans un fichier et remplacer les gestionnaires `onclick` par des `addEventListener`.
- Le limiteur de débit est en mémoire : il est remis à zéro au redémarrage et ne couvre qu'une seule instance de l'API.
- Pas de test automatique de la limitation de débit (il consommerait le quota de connexions des autres tests).

## Mise à jour des dépendances (à faire sur votre PC)
Le fichier `package-lock.json` doit être régénéré avec `npm`, que je ne peux pas lancer à votre place :
```powershell
cd backend
npm install express@4 jsonwebtoken@9
npm audit --omit=dev
```
Si `npm audit` ou Trivy signale encore `path-to-regexp` (CVE-2026-4867, corrigée en 0.1.13) :
```powershell
npm pkg set overrides.path-to-regexp=0.1.13
npm install
```
Ensuite : `docker compose up --build -d`, vérifier que l'application fonctionne, puis commiter `package.json` ET `package-lock.json`.

## Rejouer les preuves après correction
`bash scripts/proofs.sh` (avec `API=http://localhost:8080/api` sous Docker Compose) : l'injection SQL ne renvoie que vos propres tickets, l'accès au ticket d'un autre donne 403, et le commentaire HTML est affiché comme du texte.
