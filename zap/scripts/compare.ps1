# compare.ps1 - Compare les scans AVANT et APRES : quelles alertes ont disparu ?
$ErrorActionPreference = "Continue"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Out = Join-Path $Root "docs\preuves\phase7"
$b = Join-Path $Out "summary-before.csv"
$a = Join-Path $Out "summary-after.csv"
if (-not (Test-Path $b) -or -not (Test-Path $a)) { throw "Il faut d'abord lancer scan-before.ps1 et scan-after.ps1." }
$before = Import-Csv $b
$after = Import-Csv $a
$names = ($before.Alerte + $after.Alerte) | Sort-Object -Unique
$order = @{ "High" = 0; "Medium" = 1; "Low" = 2; "Informational" = 3 }
$rows = foreach ($n in $names) {
  $x = @($before | Where-Object { $_.Alerte -eq $n })
  $y = @($after | Where-Object { $_.Alerte -eq $n })
  $nb = ($x | Measure-Object -Property Occurrences -Sum).Sum
  $na = ($y | Measure-Object -Property Occurrences -Sum).Sum
  $niveau = if ($x.Count) { $x[0].Niveau } else { $y[0].Niveau }
  $etat = if ($nb -and -not $na) { "CORRIGEE" } elseif ($nb -and $na) { "PRESENTE" } else { "NOUVELLE" }
  [pscustomobject]@{ Niveau = $niveau; Alerte = $n; Avant = [int]$nb; Apres = [int]$na; Etat = $etat; Tri = $(if ($order.ContainsKey($niveau)) { $order[$niveau] } else { 9 }) }
}
$rows = $rows | Sort-Object Tri, Alerte
$rows | Format-Table Niveau, Alerte, Avant, Apres, Etat -AutoSize
$md = @("# Comparaison ZAP : avant et apres correction", "", "| Niveau | Alerte | Avant | Apres | Etat |", "|---|---|---|---|---|")
foreach ($r in $rows) { $md += "| $($r.Niveau) | $($r.Alerte) | $($r.Avant) | $($r.Apres) | $($r.Etat) |" }
$md | Set-Content -Path (Join-Path $Out "comparaison.md") -Encoding UTF8
Write-Host "Tableau ecrit dans docs\preuves\phase7\comparaison.md" -ForegroundColor Green
