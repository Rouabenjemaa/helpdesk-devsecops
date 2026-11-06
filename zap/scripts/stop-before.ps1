# stop-before.ps1 - Arrete et supprime la version AVANT correction (conteneurs, volume, copie du code).
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root
$wt = Join-Path (Split-Path $Root -Parent) "helpdesk-before"
if (Test-Path $wt) {
  docker compose -p helpdesk-before -f (Join-Path $wt "docker-compose.yml") down -v
  git worktree remove --force $wt
  Write-Host "Version AVANT supprimee." -ForegroundColor Green
} else { Write-Host "Rien a supprimer." }
