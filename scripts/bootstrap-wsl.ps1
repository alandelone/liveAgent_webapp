param(
  [switch]$IncludeModels,
  [switch]$IncludeTts,
  [string]$Distribution = "Debian"
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$drive = $repoPath.Substring(0, 1).ToLowerInvariant()
$pathWithoutDrive = $repoPath.Substring(2).Replace("\", "/")
$wslRepoPath = "/mnt/$drive$pathWithoutDrive"
$includeModelsValue = if ($IncludeModels) { "true" } else { "false" }
$includeTtsValue = if ($IncludeTts) { "true" } else { "false" }

wsl.exe -d $Distribution -u root -- bash "$wslRepoPath/scripts/bootstrap-wsl.sh" $includeModelsValue $includeTtsValue
if ($LASTEXITCODE -ne 0) {
  throw "WSL bootstrap failed with exit code $LASTEXITCODE"
}
