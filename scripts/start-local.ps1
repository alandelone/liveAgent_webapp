param([string]$Distribution = "Debian")

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dataPath = Join-Path $repoPath ".runtime-data\deployment"
$logPath = Join-Path $repoPath ".runtime-data\logs"
$statePath = Join-Path $dataPath "state.json"
$ttsPython = Join-Path $env:LOCALAPPDATA "livechat-agent\venv-tts-fast\Scripts\python.exe"
$node = Join-Path $repoPath ".tools\node-v24.19.0-win-x64\node.exe"
$vite = Join-Path $repoPath "node_modules\vite\bin\vite.js"

function Wait-Http([string]$Uri, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try { return Invoke-RestMethod -Uri $Uri -TimeoutSec 3 }
    catch { Start-Sleep -Milliseconds 500 }
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Uri"
}

function Wait-Tcp([string]$HostName, [int]$Port, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    $client = [Net.Sockets.TcpClient]::new()
    try {
      $pending = $client.ConnectAsync($HostName, $Port)
      if ($pending.Wait(500) -and $client.Connected) { return }
    } catch {} finally { $client.Dispose() }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for ${HostName}:$Port"
}

if (Test-Path -LiteralPath $statePath) {
  throw "Deployment state already exists. Run ./scripts/stop-local.ps1 before starting another stack."
}
$unsafeGpuTts = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and (
    $_.CommandLine -match 'venv-tts-gpu\\Scripts\\python\.exe' -or
    ($_.CommandLine -match 'kokoro-tts-service\.py' -and $_.CommandLine -match '--device\s+cuda')
  )
}
if ($unsafeGpuTts) {
  throw "Refusing to start Qwen ASR while CUDA Kokoro is running; this combination caused an unexpected host restart during capacity validation."
}
& (Join-Path $PSScriptRoot "bootstrap-node.ps1") | Out-Null
& (Join-Path $PSScriptRoot "bootstrap-wsl.ps1") -IncludeModels
& (Join-Path $PSScriptRoot "bootstrap-tts-windows.ps1")
if (-not (Test-Path -LiteralPath $vite)) { & (Join-Path $PSScriptRoot "npm.ps1") ci }
& (Join-Path $PSScriptRoot "npm.ps1") run build | Out-Null

$os = Get-CimInstance Win32_OperatingSystem
$freePhysicalGiB = $os.FreePhysicalMemory / 1MB
$freeVirtualGiB = $os.FreeVirtualMemory / 1MB
if ($freePhysicalGiB -lt 8 -or $freeVirtualGiB -lt 8) {
  throw ("Capacity preflight failed: at least 8 GiB free physical and commit memory are required; physical={0:N2}, commit={1:N2}." -f $freePhysicalGiB, $freeVirtualGiB)
}

$route = (wsl.exe -d $Distribution -u liveagent -- ip route show default | Out-String) -replace "`0", ""
if ($route -notmatch 'default via (?<address>\d{1,3}(?:\.\d{1,3}){3})') { throw "Could not resolve the WSL NAT host interface." }
$hostAddress = $Matches.address
$hostInterface = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $hostAddress -and $_.InterfaceAlias -match 'WSL' }
if (-not $hostInterface) { throw "WSL default gateway is not a Windows WSL virtual-interface address." }
$ttsEndpoint = "http://${hostAddress}:8771"

New-Item -ItemType Directory -Force -Path $dataPath, $logPath | Out-Null
$started = [Collections.Generic.List[Diagnostics.Process]]::new()
try {
  $tts = Start-Process -FilePath $ttsPython -ArgumentList @(
    (Join-Path $repoPath "scripts\kokoro-tts-service.py"), "--host", $hostAddress, "--allow-wsl-host-interface"
  ) -WorkingDirectory $repoPath -RedirectStandardOutput (Join-Path $logPath "tts.stdout.log") -RedirectStandardError (Join-Path $logPath "tts.stderr.log") -WindowStyle Hidden -PassThru
  $started.Add($tts)
  $health = Wait-Http "$ttsEndpoint/health" 90
  if ($health.revision -ne "01e7505bd6a7a2ac4975463114c3a7650a9f7218") { throw "TTS provenance check failed." }
  if ($health.device -ne "cpu") { throw "Deployment refuses non-CPU Kokoro because GPU ASR overlap is unsafe on this host." }
  wsl.exe -d $Distribution -u liveagent -- curl -fsS --max-time 5 "$ttsEndpoint/health" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WSL cannot reach the Windows TTS service." }

  $drive = $repoPath.Substring(0, 1).ToLowerInvariant()
  $wslRepo = "/mnt/$drive" + $repoPath.Substring(2).Replace("\", "/")
  $gateway = Start-Process -FilePath "wsl.exe" -ArgumentList @(
    "-d", $Distribution, "-u", "liveagent", "--", "bash", "$wslRepo/scripts/run-wsl-gateway.sh", $ttsEndpoint
  ) -WorkingDirectory $repoPath -RedirectStandardOutput (Join-Path $logPath "gateway.stdout.log") -RedirectStandardError (Join-Path $logPath "gateway.stderr.log") -WindowStyle Hidden -PassThru
  $started.Add($gateway)
  Wait-Tcp "127.0.0.1" 8765 150

  $viteProcess = Start-Process -FilePath $node -ArgumentList @($vite, "preview", "--host", "127.0.0.1", "--port", "5173", "--strictPort") -WorkingDirectory $repoPath -RedirectStandardOutput (Join-Path $logPath "vite.stdout.log") -RedirectStandardError (Join-Path $logPath "vite.stderr.log") -WindowStyle Hidden -PassThru
  $started.Add($viteProcess)
  Wait-Http "http://127.0.0.1:5173/live/" 30 | Out-Null
  Start-Sleep -Seconds 2
  Wait-Http "http://127.0.0.1:5173/live/" 10 | Out-Null

  [ordered]@{
    status = "running"
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    distribution = $Distribution
    ttsEndpoint = $ttsEndpoint
    ttsDevice = $health.device
    ttsPid = $tts.Id
    gatewayWindowsPid = $gateway.Id
    vitePid = $viteProcess.Id
    uiMode = "production-preview"
  } | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
  Write-Host "Livechat Agent is ready at http://127.0.0.1:5173/live/"
} catch {
  foreach ($process in $started) {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
  throw
}
