param([string]$Version = '1.4.0')
$ErrorActionPreference = 'Stop'
$extensionRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -ne $Version) { throw 'Version du manifeste différente.' }
Push-Location -LiteralPath $extensionRoot
try {
  & node scripts/build.mjs
  if ($LASTEXITCODE -ne 0) { throw 'La génération des archives a échoué.' }
} finally { Pop-Location }
