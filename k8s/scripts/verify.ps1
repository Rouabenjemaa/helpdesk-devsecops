# verify.ps1 - Preuves de durcissement (phase 6). A lancer apres deploy.ps1.
# Faites une capture d'ecran de chaque section pour le rapport.
$ErrorActionPreference = "Continue"
$ns = "helpdesk"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

function Section([string]$Title) { Write-Host ""; Write-Host "=== $Title ===" -ForegroundColor Cyan }

Section "1. Pods en fonctionnement"
kubectl get pods -n $ns -o wide

Section "2. Utilisateur des conteneurs (aucun ne doit etre root / uid 0)"
Write-Host "backend  :" -NoNewline; kubectl exec -n $ns deploy/backend -- id
Write-Host "frontend :" -NoNewline; kubectl exec -n $ns deploy/frontend -- id
Write-Host "db       :" -NoNewline; kubectl exec -n $ns deploy/db -- id

Section "3. Systeme de fichiers en lecture seule (une ecriture doit echouer)"
Write-Host "backend  :"; kubectl exec -n $ns deploy/backend -- sh -c "touch /app/test 2>&1; true"
Write-Host "frontend :"; kubectl exec -n $ns deploy/frontend -- sh -c "touch /usr/share/nginx/html/test 2>&1; true"

Section "4. securityContext du backend (extrait du manifeste applique)"
kubectl get deployment backend -n $ns -o jsonpath="{.spec.template.spec.containers[0].securityContext}"
Write-Host ""

Section "5. NetworkPolicies appliquees"
kubectl get networkpolicy -n $ns

Section "6. Isolation reseau : flux autorise et flux interdits (meme outil, meme resolution de noms)"
function Test-Flow([string]$Label, [string]$Deploy, [string]$Url, [bool]$ShouldWork) {
  $out = (& kubectl exec -n $ns "deploy/$Deploy" -- sh -c "timeout 12 wget -T 4 -O- $Url 2>&1 | head -c 400; true") -join " "
  if ($ShouldWork) {
    if ($out -match '"status":"ok"|<!DOCTYPE|<html') { $v = "AUTORISE ET FONCTIONNE (attendu)"; $c = "Green" }
    else { $v = "ECHEC : le flux legitime ne passe pas"; $c = "Red" }
  } else {
    if ($out -match 'timed out|refused|can.t connect|not permitted') { $v = "BLOQUE (attendu)"; $c = "Green" }
    elseif ($out -match 'reset by peer|error getting response|HTTP request sent|200 OK|<!DOCTYPE|<html|"status"') { $v = "JOIGNABLE : les regles ne sont PAS appliquees"; $c = "Red" }
    else { $v = "INDETERMINE (lisez la sortie brute)"; $c = "Yellow" }
  }
  Write-Host ("{0,-42} -> {1}" -f $Label, $v) -ForegroundColor $c
  if ($c -ne "Green") { Write-Host "   sortie : $out" }
}
Test-Flow "frontend -> backend:3000  (autorise)"  "frontend" "http://backend:3000/health" $true
Test-Flow "frontend -> db:5432       (interdit)"  "frontend" "http://db:5432" $false
Test-Flow "backend  -> frontend:8080 (interdit)"  "backend"  "http://frontend:8080/" $false

Write-Host ""
Write-Host "Pod intrus (aucune regle ne l'autorise) :"
kubectl delete pod intruder -n $ns --ignore-not-found *> $null
kubectl apply -f k8s/tests/intruder.yaml *> $null
kubectl wait --for=jsonpath='{.status.phase}'=Succeeded pod/intruder -n $ns --timeout=150s *> $null
$intr = (& kubectl logs intruder -n $ns) -join " "
Write-Host $intr
if ($intr -match 'DNS=OK' -and $intr -match 'timed out|refused|can.t connect') {
  Write-Host "intrus -> backend:3000 -> BLOQUE (attendu)" -ForegroundColor Green
} elseif ($intr -match 'DNS=KO') {
  Write-Host "INCONCLUANT : le nom n'a pas ete resolu, le test ne prouve rien." -ForegroundColor Yellow
} elseif ($intr -match '"status":"ok"') {
  Write-Host "JOIGNABLE : les regles ne sont PAS appliquees." -ForegroundColor Red
} else { Write-Host "INDETERMINE : lisez la sortie ci-dessus." -ForegroundColor Yellow }
kubectl delete pod intruder -n $ns --ignore-not-found *> $null

Section "7. Secrets : presents dans le cluster, absents du depot Git"
kubectl get secret -n $ns
Write-Host "Mentions dans les manifestes (uniquement des references secretKeyRef, aucune valeur) :"
git grep --untracked -n -i "secretKeyRef\|JWT_SECRET\|POSTGRES_PASSWORD" -- k8s/manifests

Section "8. L'application repond (via le NodePort)"
try {
  $r = Invoke-WebRequest -UseBasicParsing http://localhost:8081/api/health
  Write-Host "GET /api/health -> $($r.StatusCode) $($r.Content)"
} catch { Write-Host "Echec : $($_.Exception.Message)" -ForegroundColor Red }
curl.exe -sI http://localhost:8081/ | Select-String -Pattern "HTTP/|Content-Security-Policy|X-Frame-Options"
