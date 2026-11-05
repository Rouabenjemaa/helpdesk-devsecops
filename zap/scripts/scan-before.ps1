# scan-before.ps1 - Scan de la version AVANT correction (phase 2), lancee par run-before.ps1 sur le port 8090.
$core = Join-Path $PSScriptRoot "zap-scan.ps1"
& $core -Name before -HostUrl "http://localhost:8090" -ZapUrl "http://host.docker.internal:8090"
