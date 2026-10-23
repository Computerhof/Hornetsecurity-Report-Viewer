# PowerShell-Linter: prüft alle PowerShell-Skripte des Repositorys mit PSScriptAnalyzer.
# `npm run lint:ps` — benötigt das Modul PSScriptAnalyzer (Install-Module PSScriptAnalyzer -Scope CurrentUser).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
    throw 'Modul PSScriptAnalyzer fehlt: Install-Module PSScriptAnalyzer -Scope CurrentUser'
}
Import-Module PSScriptAnalyzer

# Nur Dateien des Repositorys (verfolgt oder neu, nicht ignoriert) — wie die übrigen Gates
$files = @(git -C $root ls-files --cached --others --exclude-standard -- '*.ps1' '*.psm1' |
    ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ })

$findings = @($files | ForEach-Object { Invoke-ScriptAnalyzer -Path $_ -Severity Warning, Error })
foreach ($f in $findings) {
    Write-Output ('{0}:{1} {2} {3}' -f (Resolve-Path -Relative $f.ScriptPath), $f.Line, $f.RuleName, $f.Message)
}
if ($findings.Count -gt 0) {
    Write-Output "PowerShell-Lint: $($findings.Count) Befund(e)."
    exit 1
}
Write-Output "PowerShell-Lint bestanden: $($files.Count) Datei(en)."
