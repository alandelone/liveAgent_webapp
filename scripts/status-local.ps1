$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$statePath = Join-Path $repoPath ".runtime-data\deployment\state.json"
if (-not (Test-Path -LiteralPath $statePath)) { @{ status = "stopped" } | ConvertTo-Json; exit 1 }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$checks = [ordered]@{}
try {
  $health = Invoke-RestMethod "$($state.ttsEndpoint)/health" -TimeoutSec 3
  $checks.tts = $health.status -eq "ok" -and $health.revision -eq "01e7505bd6a7a2ac4975463114c3a7650a9f7218" -and $health.device -eq "cpu"
} catch { $checks.tts = $false }
try { $checks.ui = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:5173/live/" -TimeoutSec 3).StatusCode -eq 200 } catch { $checks.ui = $false }
$unsafeGpuTts = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and (
    $_.CommandLine -match 'venv-tts-gpu\\Scripts\\python\.exe' -or
    ($_.CommandLine -match 'kokoro-tts-service\.py' -and $_.CommandLine -match '--device\s+cuda')
  )
}
$checks.gpuIsolation = -not [bool]$unsafeGpuTts
$client = [Net.Sockets.TcpClient]::new()
try { $pending = $client.ConnectAsync("127.0.0.1", 8765); $checks.gateway = $pending.Wait(1000) -and $client.Connected } catch { $checks.gateway = $false } finally { $client.Dispose() }
[ordered]@{ status = if ($checks.Values -notcontains $false) { "running" } else { "degraded" }; checks = $checks; state = $state } | ConvertTo-Json -Depth 4
if ($checks.Values -contains $false) { exit 1 }
