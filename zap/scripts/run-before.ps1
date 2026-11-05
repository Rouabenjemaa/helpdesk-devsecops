# run-before.ps1 - Lance la version AVANT correction (commit 10be198 = failles + conteneurs, phase 2)
# sur http://localhost:8090, sans toucher a votre dossier de travail ni au cluster.
# Usage : powershell -ExecutionPolicy Bypass -File zap\scripts\run-before.ps1
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root
$wt = Join-Path (Split-Path $Root -Parent) "helpdesk-before"

function Run([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Echec de la commande : $Exe $($Arguments -join ' ')" }
}
try {
  if (-not (Test-Path $wt)) {
    Write-Host "== Extraction de la version AVANT (commit 10be198) dans $wt ==" -ForegroundColor Cyan
    Run git @("worktree", "add", "--detach", $wt, "10be198")
  }
  $compose = Join-Path $wt "docker-compose.yml"
  $text = Get-Content $compose -Raw -Encoding UTF8
  $text = $text -replace '(?m)^\s*container_name:.*\r?\n', ''     # evite les conflits avec la pile habituelle
  $text = $text -replace '"8080:8080"', '"8090:8080"'               # port different : 8090
  [System.IO.File]::WriteAllText($compose, $text)

  Write-Host "== Construction et demarrage (projet 'helpdesk-before') ==" -ForegroundColor Cyan
  Run docker @("compose", "-p", "helpdesk-before", "-f", $compose, "up", "--build", "-d")

  Write-Host "== Attente de l'API ==" -ForegroundColor Cyan
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing "http://localhost:8090/api/health" -TimeoutSec 3
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
    Start-Sleep -Seconds 3
  }
  if (-not $ok) { throw "L'API ne repond pas sur http://localhost:8090 (voir : docker compose -p helpdesk-before logs)" }
  Write-Host ""
  Write-Host "Version AVANT disponible sur http://localhost:8090 (comptes de test : voir README)" -ForegroundColor Green
  Write-Host "Etape suivante : powershell -ExecutionPolicy Bypass -File zap\scripts\scan-before.ps1"
}
catch {
  Write-Host "ERREUR : $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
