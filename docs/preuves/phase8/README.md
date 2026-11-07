# Preuves phase 8 : observabilité et détection

Scénario : `k8s/scripts/simulate-attack.ps1` (login, 3 injections SQL, 1 XSS, 7 échecs de connexion).

| Fichier | Preuve |
|---|---|
| 01 | Source de données Prometheus OK dans Grafana |
| 02 | Cibles backend 2/2 UP (port 9100), Prometheus 1/1 UP |
| 03 | Exécution de la simulation d'attaque |
| 04 | Détection côté logs : 4 événements `injection_suspected` dans Loki (3 sqli, 1 xss) |
| 05 | Alertes `TentativeInjectionDetectee` et `ForceBruteConnexionPossible` en Firing |
| 06 | Détail de l'alerte force brute : seuil > 5 échecs en 5 min, valeur 7,19 |
| 07 | Dashboard HelpDesk avant l'attaque (compteurs à 0) |
| 08 | Dashboard HelpDesk après l'attaque : 4 injections détectées, 7 échecs de connexion, 3 alertes actives (2 injection : sqli et xss, 1 force brute) |

Résultat : l'attaque est détectée (2 alertes de sécurité) sans impact sur la disponibilité
(alertes PicErreursServeur et BackendIndisponible inactives).

À ajouter : capture de la source Loki en vert (01b).
