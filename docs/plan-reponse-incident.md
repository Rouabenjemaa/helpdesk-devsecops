# Plan de réponse à incident : HelpDesk

Cadre : détecter, contenir, éradiquer, rétablir, tirer les leçons. Rôles : **Roua** (analyse du backend et des données), **Mahdi** (cluster et observabilité). Un incident est ouvert dès qu'une alerte reste en `Firing` sans explication, ou qu'une anomalie est signalée.

## Alertes et première action
| Alerte | Gravité | Première action |
|---|---|---|
| `TentativeInjectionDetectee` | warning | Identifier l'adresse et le compte (étape 1 ci-dessous), puis contenir si l'activité continue |
| `ForceBruteConnexionPossible` | warning | Identifier le compte visé et l'adresse source ; vérifier qu'aucune connexion n'a réussi ensuite |
| `LimiteDeDebitDeclenchee` | info | Un client dépasse les quotas : même analyse que ci-dessus |
| `PicErreursServeur` | critical | Lire les journaux `level=error` ; vérifier la base et les pods |
| `BackendIndisponible` | critical | `kubectl get pods -n helpdesk` ; consulter `kubectl describe pod` et `kubectl logs` |

## 1. Détecter
1. Ouvrir le tableau de bord Grafana et la page Alerts de Prometheus : quelle alerte, depuis quand ?
2. Dans Grafana, Explore, source Loki :
   - attaques : `{namespace="helpdesk", app="backend", event="injection_suspected"}`
   - échecs de connexion : `{namespace="helpdesk", app="backend", event="login_failure"}`
   - erreurs : `{namespace="helpdesk", app="backend", level="error"}`
3. Noter : **heure, adresse (`ip`), compte (`username`), route, type d'attaque, charge (`sample`)**.
4. Vérifier le journal d'audit de la base :
   `kubectl exec -n helpdesk deploy/db -- psql -U helpdesk -d helpdesk -c "SELECT * FROM audit_log ORDER BY id DESC LIMIT 30;"`
5. Estimer l'impact : une connexion a-t-elle réussi après les échecs ? Des tickets ou comptes ont-ils été modifiés ?

## 2. Contenir
- **Compte compromis ou malveillant :** le désactiver (administration de l'application, ou `UPDATE users SET active = false WHERE username = '<compte>';` dans la base).
- **Invalider toutes les sessions** (jetons volés) : renouveler le secret JWT. `kubectl delete secret helpdesk-jwt -n helpdesk`, relancer `k8s\scripts\deploy.ps1`, puis `kubectl rollout restart deployment/backend -n helpdesk`. Tous les utilisateurs devront se reconnecter.
- **Source d'attaque persistante :** le limiteur de débit ralentit déjà `/login` et `/search`. En cas d'attaque soutenue, réduire temporairement le nombre de pods exposés ou isoler le frontend avec une NetworkPolicy plus stricte.
- **Ne rien supprimer** des journaux ni des pods suspects avant d'avoir sauvegardé les preuves (captures, export des requêtes Loki).

## 3. Éradiquer
1. Trouver la cause : charge qui a abouti ? route sans validation ? compte faible ?
2. Corriger dans le code (requête paramétrée, validation, droits), ajouter un **test de non-régression**, faire relire la Pull Request.
3. Si un secret a pu fuiter : le renouveler (voir la procédure de rotation, `docs/secrets-phase4.md`).
4. Relancer les scans (pipeline, ZAP) pour confirmer la correction.

## 4. Rétablir
1. Déployer l'image corrigée (nouveau SHA dans `20-backend.yaml`, `deploy.ps1`).
2. Vérifier : pods `Running`, `/health` à 200, tableau de bord sans alerte.
3. Restaurer les données altérées. **Limite :** ce laboratoire n'a pas de sauvegarde automatique de la base ; les données sont fictives et se réinitialisent depuis `db/init.sql`.
4. Prévenir les utilisateurs concernés (reconnexion, changement de mot de passe).

## 5. Enseignements
Dans les 48 heures, rédiger un court compte rendu :
| Élément | Contenu |
|---|---|
| Chronologie | heure de l'attaque, de la détection, de la contention, du rétablissement |
| Cause | ce qui a rendu l'attaque possible |
| Ce qui a bien marché | détection, journaux utiles |
| Ce qui a manqué | alerte trop tardive, information absente du journal |
| Actions | correctif, nouveau test, nouvelle règle d'alerte, responsable et date |

## Exercice
`k8s\scripts\simulate-attack.ps1` rejoue des attaques contre l'instance locale : il permet de s'entraîner à cette procédure. Documentez l'exercice (captures de l'alerte, de la requête Loki, du tableau de bord) dans le rapport.
