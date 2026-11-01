# Pipeline CI/CD bloquant (phase 3)

Fichier : `.github/workflows/ci.yml`. Déclenché à chaque `push` sur `main`, `dev`, `feat/**` et à chaque Pull Request vers `main` ou `dev`.

| Job | Outil | Responsable | Bloque si | Résultat attendu en phase 3 |
|---|---|---|---|---|
| Build et tests | npm | Roua | `npm ci` ou `npm test` échoue | vert |
| Secrets | Gitleaks | Roua | un secret est détecté (code ou historique Git) | **rouge** (VULN-004) |
| SAST | Semgrep | Roua | règle de sévérité ERROR | **rouge** (injection SQL, secret en dur) |
| Dépendances | Trivy (fs) | Mahdi | CRITICAL, ou HIGH avec correctif existant | **rouge** (express 4.17.1, jsonwebtoken 8.5.1) |
| Image | Docker build + Trivy | Mahdi | CRITICAL, ou image exécutée en root | vert si pas de CVE critique corrigeable |
| Publication | GHCR | Roua | (exécuté seulement si tout est vert, sur `main`) | **non exécuté** |

## Pourquoi c'est bloquant
Aucun contrôle n'utilise `|| true` ni `continue-on-error`. Un code qui contient un secret, une injection SQL ou une dépendance vulnérable ne peut donc pas être publié : le job `push-image` dépend de tous les autres.

## Point d'attention : l'historique Git
Gitleaks est lancé en ligne de commande (`gitleaks detect`) et analyse tout l'historique. L'action `gitleaks-action` n'a pas été retenue : elle ne scanne que les commits du push en cours et laissait passer un secret déjà présent dans l'historique (constaté au run #2). Même après correction du code, le secret reste dans d'anciens commits : le job ne passera au vert qu'après la procédure de rotation de la phase 4 (réécriture de l'historique ou nouveau dépôt propre).

## Ne pas exiger les contrôles avant la phase 5
Dans les règles de protection de `main`, n'ajoutez pas ces jobs en « required status checks » tant que le pipeline est rouge : plus aucune Pull Request (même celle qui corrige les failles) ne pourrait être fusionnée.

## Preuve à capturer
Onglet **Actions** de GitHub : le run avec les jobs Gitleaks, Semgrep et Trivy en rouge, et le résumé en bas de page. Une deuxième capture, verte, sera prise après les phases 4 et 5.
