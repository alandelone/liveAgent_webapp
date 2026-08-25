param([string]$Distribution = "Debian")

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputPath = Join-Path $repoPath "deployment\recovery-evidence.json"
$statePath = Join-Path $repoPath ".runtime-data\deployment\state.json"
$evidence = [ordered]@{ schemaVersion = 1; startedAt = (Get-Date).ToUniversalTime().ToString("o"); distribution = $Distribution }

function Read-Status {
  $text = & (Join-Path $PSScriptRoot "status-local.ps1") 2>&1 | Out-String
  $status = $text | ConvertFrom-Json
  if ($status.status -ne "running") { throw "Deployment health check failed: $text" }
  return $status
}

function Wait-Capacity([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $os = Get-CimInstance Win32_OperatingSystem
    $physical = $os.FreePhysicalMemory / 1MB
    $commit = $os.FreeVirtualMemory / 1MB
    $engines = (wsl.exe -d $Distribution -- bash -lc "ps -eo args= | grep 'VLLM::EngineCore' | grep -v grep | wc -l").Trim()
    if ($physical -ge 8 -and $commit -ge 8 -and $engines -eq "0") {
      return [ordered]@{ freePhysicalGiB = [math]::Round($physical, 3); freeCommitGiB = [math]::Round($commit, 3); asrEngines = 0 }
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "Capacity did not recover within $Seconds seconds (physical=$physical GiB, commit=$commit GiB, engines=$engines)."
}

try {
  $evidence.before = Read-Status
  & (Join-Path $PSScriptRoot "stop-local.ps1") | Out-Null
  if (Test-Path -LiteralPath $statePath) { throw "Stop left stale deployment state." }
  $evidence.recoveredCapacity = Wait-Capacity 120
  & (Join-Path $PSScriptRoot "start-local.ps1") -Distribution $Distribution | Out-Null
  $evidence.after = Read-Status
  & (Join-Path $PSScriptRoot "npm.ps1") run test:runtime -- --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Runtime safety/refusal tests failed." }
  $evidence.runtimeSafetyTests = "pass"
  $evidence.status = "pass"
} catch {
  $evidence.status = "fail"
  $evidence.error = $_.Exception.Message
  if (-not (Test-Path -LiteralPath $statePath)) {
    try {
      Wait-Capacity 120 | Out-Null
      & (Join-Path $PSScriptRoot "start-local.ps1") -Distribution $Distribution | Out-Null
      $evidence.emergencyRestore = Read-Status
    } catch { $evidence.emergencyRestoreError = $_.Exception.Message }
  }
} finally {
  $evidence.finishedAt = (Get-Date).ToUniversalTime().ToString("o")
  $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding utf8
}

$evidence | ConvertTo-Json -Depth 8
if ($evidence.status -ne "pass") { exit 1 }
