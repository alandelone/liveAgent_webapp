param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NpmArguments)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$nodeRoot = Join-Path $repoRoot ".tools\node-v24.19.0-win-x64"
$npm = Join-Path $nodeRoot "npm.cmd"

if (-not (Test-Path -LiteralPath $npm)) {
  & (Join-Path $PSScriptRoot "bootstrap-node.ps1")
}
$env:PATH = "$nodeRoot;$env:PATH"
& $npm @NpmArguments
exit $LASTEXITCODE

