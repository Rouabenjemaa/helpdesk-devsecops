# simulate-attack.ps1 - Simule des attaques CONTRE VOTRE PROPRE INSTANCE LOCALE pour les retrouver
# dans les journaux (Loki), les metriques (Prometheus) et les alertes (Grafana).
# Usage : powershell -ExecutionPolicy Bypass -File k8s\scripts\simulate-attack.ps1
param([string]$Base = "http://localhost:8081")
$ErrorActionPreference = "Continue"

# Garde-fou : uniquement l'instance locale du projet.
$h = ([System.Uri]$Base).Host
if (@("localhost", "127.0.0.1") -notcontains $h) { throw "Cible refusee : '$h'. Seule l'instance locale peut etre attaquee." }

function Send([string]$Label, [string]$Method, [string]$Path, $Body, [string]$Token) {
  $headers = @{}
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  try {
    $params = @{ Uri = "$Base/api$Path"; Method = $Method; Headers = $headers; UseBasicParsing = $true; ContentType = "application/json" }
    if ($Body) { $params["Body"] = ($Body | ConvertTo-Json -Compress) }
    $r = Invoke-WebRequest @params
    $code = [int]$r.StatusCode
    $content = $r.Content
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    $content = ""
  }
  Write-Host ("{0,-52} -> HTTP {1}" -f $Label, $code)
  return $content
}

Write-Host "== 1. Connexion legitime (roua) ==" -ForegroundColor Cyan
$login = Invoke-RestMethod -Method Post -Uri "$Base/api/login" -ContentType "application/json" -Body '{"username":"roua","password":"Passw0rd!"}'
$token = $login.token
if (-not $token) { throw "Connexion impossible sur $Base" }
Write-Host "Connecte."

Write-Host ""
Write-Host "== 2. Injections SQL dans la recherche (doivent etre DETECTEES, pas executees) ==" -ForegroundColor Cyan
foreach ($payload in @("' OR 1=1 --", "x' UNION SELECT username,password FROM users --", "x'; DROP TABLE users; --")) {
  [void](Send "recherche : $payload" "GET" ("/search?q=" + [uri]::EscapeDataString($payload)) $null $token)
}

Write-Host ""
Write-Host "== 3. Commentaire XSS sur un ticket de roua ==" -ForegroundColor Cyan
$tickets = Send "liste des tickets" "GET" "/tickets" $null $token
$list = $tickets | ConvertFrom-Json
if ($list.Count -gt 0) {
  [void](Send "commentaire <img onerror=...>" "POST" "/tickets/$($list[0].id)/comments" @{ body = '<img src=x onerror="alert(1)">' } $token)
}

Write-Host ""
Write-Host "== 4. Sept echecs de connexion (force brute simulee) ==" -ForegroundColor Cyan
1..7 | ForEach-Object { [void](Send "connexion admin1, mauvais mot de passe #$_" "POST" "/login" @{ username = "admin1"; password = "mauvais-mot-de-passe-$_" } $null) }

Write-Host ""
Write-Host "Simulation terminee. Ou regarder (comptez 15 a 30 secondes pour la collecte) :" -ForegroundColor Green
Write-Host " - Grafana, tableau de bord 'HelpDesk - Securite et exploitation' : compteurs, graphiques, journaux d'attaque"
Write-Host " - Prometheus, page Alerts (http://localhost:9090/alerts) : TentativeInjectionDetectee, ForceBruteConnexionPossible"
Write-Host " - Grafana, Explore, source Loki : {namespace=""helpdesk"", app=""backend"", event=""injection_suspected""}"
