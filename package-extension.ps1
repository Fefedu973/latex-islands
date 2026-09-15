param([string]$Version = '')
$ErrorActionPreference = 'Stop'
$extensionRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($Version -and $manifest.version -ne $Version) { throw 'Manifest version mismatch.' }
Push-Location -LiteralPath $extensionRoot
try {
  & node scripts/build.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Package generation failed.' }
} finally { Pop-Location }
