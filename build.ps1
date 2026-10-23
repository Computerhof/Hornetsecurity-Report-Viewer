# Baut die portable Einzeldatei dist/Hornetsecurity-Report-Viewer.html aus src/
# Die Version kommt ausschließlich aus package.json (Single Source of Truth).
# Läuft unter Windows PowerShell 5.1 und PowerShell 7 (Windows/Linux/macOS).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$version = (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Ungültige Version in package.json: '$version'" }

$template = [System.IO.File]::ReadAllText((Join-Path $root 'src/template.html'))
$core = [System.IO.File]::ReadAllText((Join-Path $root 'src/core.js'))
$ui = [System.IO.File]::ReadAllText((Join-Path $root 'src/ui.js'))

foreach ($token in '/*__CORE__*/', '/*__UI__*/', '__VERSION__') {
    if (-not $template.Contains($token)) { throw "Token $token fehlt im Template." }
}
if (-not $ui.Contains('__VERSION__')) { throw "Token __VERSION__ fehlt in ui.js." }

$out = $template.Replace('/*__CORE__*/', $core).Replace('/*__UI__*/', $ui).Replace('__VERSION__', $version)
if ($out.Contains('__VERSION__')) { throw "Unersetzter Versions-Token im Ergebnis." }

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$outPath = Join-Path $dist 'Hornetsecurity-Report-Viewer.html'
[System.IO.File]::WriteAllText($outPath, $out, [System.Text.UTF8Encoding]::new($false))

Write-Host "Gebaut: $outPath (v$version, $([math]::Round((Get-Item $outPath).Length / 1KB)) KB)"
