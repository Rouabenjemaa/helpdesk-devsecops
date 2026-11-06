# zap-scan.ps1 - Scan ZAP (baseline + API) d'UNE instance de HelpDesk.
# Ne pas lancer directement : utiliser scan-before.ps1 ou scan-after.ps1.
param(
  [Parameter(Mandatory = $true)][ValidateSet("before", "after")][string]$Name,
  [Parameter(Mandatory = $true)][string]$HostUrl,   # URL joignable depuis ce PC (pour obtenir le jeton)
  [Parameter(Mandatory = $true)][string]$ZapUrl,    # URL telle que la voit le conteneur ZAP
  [string]$Network = ""                              # reseau Docker a rejoindre (ex. kind)
)
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Out = Join-Path $Root "docs\preuves\phase7"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

# Garde-fou : on ne scanne QUE nos propres instances locales (perimetre impose par le cahier des charges).
$zapHost = ([System.Uri]$ZapUrl).Host
if (@("host.docker.internal", "helpdesk-control-plane", "localhost") -notcontains $zapHost) {
  throw "Cible refusee : '$zapHost'. Seules les instances locales de HelpDesk peuvent etre scannees."
}

function Get-ZapAlerts([string]$Path) {
  if (-not (Test-Path $Path)) { return @() }
  $j = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($site in $j.site) {
    foreach ($a in $site.alerts) {
      $label = if ($a.name) { $a.name } else { $a.alert }
      [pscustomobject]@{ Risk = [int]$a.riskcode; Niveau = (($a.riskdesc -split " ")[0]); Alerte = $label; Occurrences = [int]$a.count }
    }
  }
}

Write-Host "== 1/5 Jeton de connexion (utilisateur 'roua', sans privilege) ==" -ForegroundColor Cyan
try {
  $login = Invoke-RestMethod -Method Post -Uri "$HostUrl/api/login" -ContentType "application/json" -Body '{"username":"roua","password":"Passw0rd!"}'
  $token = $login.token
} catch { throw "Connexion impossible sur $HostUrl : $($_.Exception.Message)" }
if (-not $token) { throw "Aucun jeton recu de $HostUrl" }

Write-Host "== 2/5 Preparation du dossier de travail (hors du depot : il contient le jeton) ==" -ForegroundColor Cyan
$work = Join-Path $env:TEMP "zap-work-$Name"
if (Test-Path $work) { Remove-Item -Recurse -Force $work }
New-Item -ItemType Directory -Force -Path $work | Out-Null
$spec = (Get-Content (Join-Path $Root "zap\openapi.template.json") -Raw -Encoding UTF8).Replace("__BASE_URL__", $ZapUrl.TrimEnd("/"))
[System.IO.File]::WriteAllText((Join-Path $work "openapi.json"), $spec)
$opts = @(
  "replacer.full_list(0).description=auth1",
  "replacer.full_list(0).enabled=true",
  "replacer.full_list(0).matchtype=REQ_HEADER",
  "replacer.full_list(0).matchstr=Authorization",
  "replacer.full_list(0).regex=false",
  "replacer.full_list(0).replacement=Bearer $token"
) -join "`n"
[System.IO.File]::WriteAllText((Join-Path $work "options.prop"), $opts)

$img = "zaproxy/zap-stable"
$netArgs = @()
if ($Network) { $netArgs = @("--network", $Network) }

Write-Host "== 3/5 Scan de base (passif : en-tetes, exploration) ==" -ForegroundColor Cyan
& docker run --rm @netArgs -v "${work}:/zap/wrk:rw" -t $img zap-baseline.py -t $ZapUrl -r "baseline-$Name.html" -J "baseline-$Name.json" -I

Write-Host "== 4/5 Scan de l'API (ACTIF : injections, etc. Compter 10 a 40 minutes) ==" -ForegroundColor Cyan
& docker run --rm @netArgs -v "${work}:/zap/wrk:rw" -t $img zap-api-scan.py -t openapi.json -f openapi -r "api-$Name.html" -J "api-$Name.json" -z "-configfile /zap/wrk/options.prop" -I

Write-Host "== 5/5 Rapports et resume ==" -ForegroundColor Cyan
foreach ($f in "baseline-$Name.html", "baseline-$Name.json", "api-$Name.html", "api-$Name.json") {
  $src = Join-Path $work $f
  if (Test-Path $src) { Copy-Item $src $Out -Force } else { Write-Host "ATTENTION : $f n'a pas ete produit" -ForegroundColor Yellow }
}
Remove-Item -Recurse -Force $work   # supprime aussi options.prop (jeton)

$all = @()
$all += Get-ZapAlerts (Join-Path $Out "baseline-$Name.json") | ForEach-Object { $_ | Add-Member -NotePropertyName Scan -NotePropertyValue "baseline" -PassThru }
$all += Get-ZapAlerts (Join-Path $Out "api-$Name.json") | ForEach-Object { $_ | Add-Member -NotePropertyName Scan -NotePropertyValue "api" -PassThru }
$all | Sort-Object -Property @{Expression = "Risk"; Descending = $true }, Alerte | Select-Object Scan, Niveau, Alerte, Occurrences | Export-Csv -Path (Join-Path $Out "summary-$Name.csv") -NoTypeInformation -Encoding UTF8
Write-Host ""
$all | Sort-Object -Property @{Expression = "Risk"; Descending = $true }, Alerte | Format-Table Scan, Niveau, Alerte, Occurrences -AutoSize
Write-Host "Rapports dans : $Out" -ForegroundColor Green
