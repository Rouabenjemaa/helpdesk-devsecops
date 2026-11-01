# Gestion des secrets (phase 4)

## Principe
Un secret ne doit jamais être écrit dans le code ni dans un fichier versionné. Il est **fourni à l'exécution** par l'environnement, et **différent pour chaque environnement**.

| Où tourne l'application | Où vit le secret |
|---|---|
| Poste local (Docker Compose) | fichier `.env` (listé dans `.gitignore`, jamais commité) |
| Pipeline GitHub Actions | GitHub Secrets (Settings, Secrets and variables, Actions) |
| Cluster Kubernetes (phase 6) | objet `Secret` créé avec `kubectl`, hors dépôt |

Le backend refuse de démarrer si `JWT_SECRET` est absent ou fait moins de 32 caractères (aucune valeur par défaut).

## 1. Générer un nouveau secret
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Cela donne 64 caractères hexadécimaux, générés de façon cryptographiquement sûre.

## 2. Poste local
```powershell
$s = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Add-Content -Path .env -Value "`nJWT_SECRET=$s"
Select-String -Path .env -Pattern "JWT_SECRET"    # une seule ligne attendue
docker compose up --build -d
```

## 3. GitHub Secrets (pipeline)
Dépôt GitHub, Settings, Secrets and variables, Actions, New repository secret. Nom : `JWT_SECRET`, valeur : un secret **différent** de celui du poste local. Il sera lu par le job de déploiement de la phase 6 : `${{ secrets.JWT_SECRET }}`. GitHub masque automatiquement sa valeur dans les journaux.

## 4. Secret Kubernetes (phase 6)
Une fois le cluster `kind` créé :
```powershell
kubectl create secret generic helpdesk-jwt --from-literal=JWT_SECRET=<valeur>
```
Dans le Deployment du backend :
```yaml
env:
  - name: JWT_SECRET
    valueFrom:
      secretKeyRef:
        name: helpdesk-jwt
        key: JWT_SECRET
```
Ne jamais écrire un manifeste `Secret` avec la valeur dans le dépôt : un Secret Kubernetes n'est que de l'encodage base64, pas du chiffrement.

## 5. Rotation en 4 étapes (dans cet ordre)
1. **Remplacer** : générer un nouveau secret ; l'ancien est considéré comme compromis. Les jetons signés avec l'ancien deviennent invalides, donc les utilisateurs doivent se reconnecter.
2. **Mettre à jour les déploiements** : `.env` local, GitHub Secrets, Secret Kubernetes ; puis redémarrer (`docker compose up -d`).
3. **Nettoyer l'historique Git** : l'ancien secret reste lisible dans les anciens commits (voir section 6).
4. **Relancer Gitleaks** pour confirmer qu'il ne détecte plus rien.

Preuve que la rotation fonctionne (un jeton de l'ancien secret doit être refusé) :
```powershell
# AVANT de redémarrer avec le nouveau secret :
$r = Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/login -ContentType "application/json" -Body '{"username":"roua","password":"Passw0rd!"}'
$old = $r.token
# APRÈS redémarrage avec le nouveau secret :
try { Invoke-RestMethod -Uri http://localhost:8080/api/tickets -Headers @{Authorization="Bearer $old"} } catch { $_.Exception.Response.StatusCode }
```
Résultat attendu : `Unauthorized` (401) ou `Forbidden` (403).

## 6. Historique Git : deux options
Gitleaks analyse tout l'historique. Même après correction du code, l'ancien secret est présent dans d'anciens commits, donc le job reste rouge.

**Option A : réécrire l'historique** (méthode demandée par le cahier). Avec `git filter-repo`, sur un **clone neuf** et après sauvegarde, on remplace la valeur de l'ancien secret par un texte neutre dans tous les commits, puis on force le push de toutes les branches. Conséquences : tous les identifiants de commit changent, le binôme doit recloner, et les anciens runs ou Pull Requests pointent vers des commits qui n'existent plus. Ne la lancez qu'après avoir fusionné le code corrigé, en prévenant Mahdi.

**Option B : liste d'exceptions** (`.gitleaksignore`). On y inscrit les empreintes des 3 résultats connus. Simple et sans risque, mais le secret reste lisible dans l'historique ; acceptable ici seulement parce qu'il est fictif et révoqué. À documenter dans le rapport comme risque accepté.

**État du dépôt :** l'option B est appliquée (fichier `.gitleaksignore` à la racine, avec les 3 empreintes relevées dans le journal Gitleaks du run #5). L'option A reste possible en fin de projet.

Dans tous les cas, **ne collez jamais l'ancienne valeur dans un fichier du dépôt** : Gitleaks la détecterait aussitôt.
