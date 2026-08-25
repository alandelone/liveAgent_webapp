param([string]$Distribution = "Debian")

$ErrorActionPreference = "Stop"
$result = [ordered]@{}
$result.checkedAt = (Get-Date).ToUniversalTime().ToString("o")
$result.distribution = $Distribution
$result.windowsGpu = (nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader).Trim()
if ($LASTEXITCODE -ne 0) { throw "Windows nvidia-smi failed" }

$registered = wsl.exe --list --quiet | ForEach-Object { ($_ -replace "`0", "").Trim() } | Where-Object { $_ }
if ($registered -notcontains $Distribution) { throw "WSL distribution '$Distribution' is not registered" }

$result.kernel = (wsl.exe -d $Distribution -u root -- uname -r).Trim()
if ($LASTEXITCODE -ne 0) { throw "Linux kernel preflight failed" }
$result.linuxGpu = (wsl.exe -d $Distribution -u root -- nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader).Trim()
if ($LASTEXITCODE -ne 0) { throw "Linux GPU preflight failed" }
$result.python = (wsl.exe -d $Distribution -u root -- /opt/livechat-agent/.venv/bin/python --version 2>&1).Trim()
if ($LASTEXITCODE -ne 0) { throw "Linux Python preflight failed" }
$result.uv = (wsl.exe -d $Distribution -u root -- /usr/local/bin/uv --version).Trim()
if ($LASTEXITCODE -ne 0) { throw "Linux uv preflight failed" }
$result.status = "pass"
$result | ConvertTo-Json
