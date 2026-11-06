# deploy-observability.ps1 - Deploie Prometheus, Loki, Grafana et l'agent de journaux (phase 8).
# A lancer APRES deploy.ps1 (l'application doit tourner dans le cluster).
# Usage : powershell -ExecutionPolicy Bypass -File k8s\scripts\deploy-observability.ps1
# Le script est rejouable : le mot de passe Grafana existant n'est jamais regenere.
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

function Run([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Echec de la commande : $Exe $($Arguments -join ' ')" }
}
function Exists([string[]]$Arguments) {
  & kubectl @Arguments *> $null
  return ($LASTEXITCODE -eq 0)
}
function New-HexSecret([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return (($buffer | ForEach-Object { $_.ToString("x2") }) -join "")
}

try {
  Write-Host "== 1/6 Verification du cluster et de l'application ==" -ForegroundColor Cyan
  & kubectl config use-context "kind-helpdesk" *> $null
  if ($LASTEXITCODE -ne 0) { throw "Cluster kind-helpdesk introuvable. Lancez d'abord k8s\scripts\deploy.ps1." }
  if (-not (Exists @("get", "deployment", "backend", "-n", "helpdesk"))) { throw "L'application n'est pas deployee. Lancez d'abord k8s\scripts\deploy.ps1." }

  Write-Host "== 2/6 Application du backend mis a jour (port de metriques, NetworkPolicy) ==" -ForegroundColor Cyan
  Run kubectl @("apply", "-f", "k8s/manifests/20-backend.yaml")
  Run kubectl @("apply", "-f", "k8s/manifests/40-networkpolicies.yaml")

  Write-Host "== 3/6 Espaces de noms ==" -ForegroundColor Cyan
  Run kubectl @("apply", "-f", "k8s/observability/00-namespaces.yaml")

  Write-Host "== 4/6 Mot de passe Grafana (genere localement, jamais ecrit dans un fichier) ==" -ForegroundColor Cyan
  if (-not (Exists @("get", "secret", "grafana-admin", "-n", "monitoring"))) {
    $pwd = New-HexSecret 16
    Run kubectl @("create", "secret", "generic", "grafana-admin", "-n", "monitoring", "--from-literal=admin-password=$pwd")
  } else { Write-Host "Secret grafana-admin deja present : conserve." }

  Write-Host "== 5/6 Tableau de bord et manifestes ==" -ForegroundColor Cyan
  $cm = & kubectl create configmap grafana-dashboards -n monitoring "--from-file=helpdesk.json=k8s/observability/dashboards/helpdesk.json" --dry-run=client -o yaml
  if ($LASTEXITCODE -ne 0) { throw "Impossible de preparer le tableau de bord." }
  $cm | & kubectl apply -f -
  if ($LASTEXITCODE -ne 0) { throw "Impossible d'appliquer le tableau de bord." }
  foreach ($file in "10-prometheus", "20-loki", "30-alloy", "40-grafana", "50-networkpolicies") {
    Run kubectl @("apply", "-f", "k8s/observability/$file.yaml")
  }

  Write-Host "== 6/6 Attente du demarrage (la premiere fois, les images se telechargent : 5 a 15 minutes) ==" -ForegroundColor Cyan
  Run kubectl @("rollout", "status", "deployment/backend", "-n", "helpdesk", "--timeout=300s")
  foreach ($app in "prometheus", "loki", "grafana") {
    Run kubectl @("rollout", "status", "deployment/$app", "-n", "monitoring", "--timeout=900s")
  }
  Run kubectl @("rollout", "status", "daemonset/alloy", "-n", "log-agent", "--timeout=900s")

  Write-Host ""
  & kubectl get pods -n monitoring
  & kubectl get pods -n log-agent
  Write-Host ""
  Write-Host "Observabilite deployee." -ForegroundColor Green
  Write-Host "Ouvrir Grafana    : kubectl port-forward -n monitoring svc/grafana 3000:3000   puis http://localhost:3000"
  Write-Host "Ouvrir Prometheus : kubectl port-forward -n monitoring svc/prometheus 9090:9090 puis http://localhost:9090"
  Write-Host "Mot de passe Grafana (utilisateur admin) :"
  Write-Host '  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String((kubectl get secret grafana-admin -n monitoring -o jsonpath="{.data.admin-password}")))'
  Write-Host "Etape suivante : powershell -ExecutionPolicy Bypass -File k8s\scripts\simulate-attack.ps1"
}
catch {
  Write-Host ""
  Write-Host "ERREUR : $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Pour comprendre : kubectl get pods -A   puis   kubectl describe pod <nom> -n <espace>   et   kubectl logs <nom> -n <espace>"
  exit 1
}
