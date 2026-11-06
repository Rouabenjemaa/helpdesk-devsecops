# deploy.ps1 - Deploiement de HelpDesk dans le cluster kind (phase 6)
# Usage, depuis n'importe quel dossier :
#   powershell -ExecutionPolicy Bypass -File k8s\scripts\deploy.ps1
# Le script est rejouable : les secrets existants ne sont JAMAIS regeneres.
$ErrorActionPreference = "Continue"
$Namespace = "helpdesk"
$Cluster = "helpdesk"
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
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($buffer)
  return (($buffer | ForEach-Object { $_.ToString("x2") }) -join "")
}

try {
  Write-Host "== 1/7 Verification des outils ==" -ForegroundColor Cyan
  foreach ($tool in "docker", "kubectl", "kind") {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
      throw "$tool est introuvable. Installez-le puis fermez et rouvrez PowerShell (voir docs/phase6-kubernetes.md)."
    }
  }
  & kubectl config use-context "kind-$Cluster" *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Le cluster kind '$Cluster' n'existe pas. Creez-le : kind create cluster --name $Cluster --config k8s\kind-config.yaml"
  }

  Write-Host "== 2/7 Construction de l'image frontend et chargement dans kind ==" -ForegroundColor Cyan
  Run docker @("build", "-t", "helpdesk-frontend:phase6", "frontend")
  Run kind @("load", "docker-image", "helpdesk-frontend:phase6", "--name", $Cluster)

  Write-Host "== 3/7 Espace de noms (Pod Security 'restricted') ==" -ForegroundColor Cyan
  Run kubectl @("apply", "-f", "k8s/manifests/00-namespace.yaml")

  Write-Host "== 4/7 Secrets (generes localement, jamais ecrits dans un fichier) ==" -ForegroundColor Cyan
  if (-not (Exists @("get", "secret", "helpdesk-jwt", "-n", $Namespace))) {
    $jwt = New-HexSecret 32
    Run kubectl @("create", "secret", "generic", "helpdesk-jwt", "-n", $Namespace, "--from-literal=JWT_SECRET=$jwt")
  } else { Write-Host "Secret helpdesk-jwt deja present : conserve." }
  if (-not (Exists @("get", "secret", "helpdesk-db", "-n", $Namespace))) {
    $dbpass = New-HexSecret 24
    Run kubectl @("create", "secret", "generic", "helpdesk-db", "-n", $Namespace, "--from-literal=POSTGRES_PASSWORD=$dbpass")
  } else { Write-Host "Secret helpdesk-db deja present : conserve." }

  Write-Host "== 5/7 Schema et donnees fictives de la base (ConfigMap) ==" -ForegroundColor Cyan
  $cm = & kubectl create configmap helpdesk-db-init -n $Namespace "--from-file=init.sql=db/init.sql" --dry-run=client -o yaml
  if ($LASTEXITCODE -ne 0) { throw "Impossible de preparer le ConfigMap de la base." }
  $cm | & kubectl apply -f -
  if ($LASTEXITCODE -ne 0) { throw "Impossible d'appliquer le ConfigMap de la base." }

  Write-Host "== 6/7 Application des manifestes ==" -ForegroundColor Cyan
  foreach ($file in "10-postgres", "20-backend", "30-frontend", "40-networkpolicies") {
    Run kubectl @("apply", "-f", "k8s/manifests/$file.yaml")
  }

  Write-Host "== 7/7 Attente du demarrage des pods ==" -ForegroundColor Cyan
  foreach ($app in "db", "backend", "frontend") {
    Run kubectl @("rollout", "status", "deployment/$app", "-n", $Namespace, "--timeout=240s")
  }

  Write-Host ""
  & kubectl get pods -n $Namespace
  Write-Host ""
  Write-Host "Application disponible sur http://localhost:8081  (comptes de test : voir README)" -ForegroundColor Green
  Write-Host "Etape suivante : powershell -ExecutionPolicy Bypass -File k8s\scripts\verify.ps1"
}
catch {
  Write-Host ""
  Write-Host "ERREUR : $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Pour comprendre : kubectl get pods -n $Namespace   puis   kubectl describe pod <nom> -n $Namespace   et   kubectl logs <nom> -n $Namespace"
  exit 1
}
