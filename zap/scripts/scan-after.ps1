# scan-after.ps1 - Scan de la version CORRIGEE deployee dans le cluster kind.
# ZAP rejoint le reseau Docker de kind et attaque le NodePort 30080 du noeud (pas besoin du port local).
$core = Join-Path $PSScriptRoot "zap-scan.ps1"
& $core -Name after -HostUrl "http://localhost:8081" -ZapUrl "http://helpdesk-control-plane:30080" -Network "kind"
