$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$statePath = Join-Path $repoPath ".runtime-data\deployment\state.json"
$linuxPidPath = Join-Path $repoPath ".runtime-data\deployment\gateway-linux.pid"
if (-not (Test-Path -LiteralPath $statePath)) { Write-Host "Livechat Agent is not recorded as running."; exit 0 }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json

if (Test-Path -LiteralPath $linuxPidPath) {
  $linuxPid = (Get-Content -LiteralPath $linuxPidPath -Raw).Trim()
  if ($linuxPid -match '^\d+$') {
    $command = (wsl.exe -d $state.distribution -u root -- bash -lc "tr '\0' ' ' < /proc/$linuxPid/cmdline 2>/dev/null || true" | Out-String)
    if ($command -match '/opt/livechat-agent/.venv/bin/python server.py') {
      wsl.exe -d $state.distribution -u root -- kill -TERM $linuxPid | Out-Null
    }
  }
}

foreach ($entry in @(
  @{ pid = $state.vitePid; marker = "node_modules\vite\bin\vite.js" },
  @{ pid = $state.gatewayWindowsPid; marker = "run-wsl-gateway.sh" },
  @{ pid = $state.ttsPid; marker = "kokoro-tts-service.py" }
)) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.pid)" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -match [regex]::Escape($entry.marker)) {
    Stop-Process -Id $entry.pid -Force -ErrorAction SilentlyContinue
  }
}
Remove-Item -LiteralPath $statePath, $linuxPidPath -Force -ErrorAction SilentlyContinue
Write-Host "Livechat Agent services stopped. Logs remain in .runtime-data/logs."
