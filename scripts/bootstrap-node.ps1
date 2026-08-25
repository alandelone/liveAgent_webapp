param([string]$Version = "24.19.0")

$ErrorActionPreference = "Stop"
if ($Version -ne "24.19.0") {
  throw "Only the reviewed Node 24.19.0 toolchain is supported by this bootstrap"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$toolsRoot = Join-Path $repoRoot ".tools"
$nodeRoot = Join-Path $toolsRoot "node-v$Version-win-x64"
$nodeExecutable = Join-Path $nodeRoot "node.exe"
$archive = Join-Path $toolsRoot "node-v$Version-win-x64.zip"
$expectedSha256 = "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73"

if (Test-Path -LiteralPath $nodeExecutable) {
  $installedVersion = (& $nodeExecutable --version).Trim()
  if ($installedVersion -ne "v$Version") {
    throw "Unexpected portable Node version: $installedVersion"
  }
  $installedVersion
  exit 0
}

New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
Invoke-WebRequest -Uri "https://nodejs.org/dist/v$Version/node-v$Version-win-x64.zip" -OutFile $archive
$actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) {
  throw "Node archive checksum mismatch: $actualSha256"
}

Expand-Archive -LiteralPath $archive -DestinationPath $toolsRoot
if (-not (Test-Path -LiteralPath $nodeExecutable)) {
  throw "Node bootstrap completed without producing $nodeExecutable"
}
& $nodeExecutable --version
