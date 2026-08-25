param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA "livechat-agent"),
  [ValidateSet("cpu", "cuda")][string]$Device = "cpu"
)

$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$requirements = Join-Path $repoPath $(if ($Device -eq "cuda") { "requirements-tts-gpu.txt" } else { "requirements-tts-fast.txt" })
$environmentPath = Join-Path $RuntimeRoot $(if ($Device -eq "cuda") { "venv-tts-gpu" } else { "venv-tts-fast" })
$pythonPath = Join-Path $environmentPath "Scripts\python.exe"
$uv = (Get-Command uv -ErrorAction Stop).Source

New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
if (-not (Test-Path -LiteralPath $pythonPath)) {
  & $uv venv $environmentPath --python 3.12
  if ($LASTEXITCODE -ne 0) { throw "Failed to create the Windows TTS environment." }
}

$version = & $pythonPath -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($version -ne "3.12") {
  throw "Existing Windows TTS environment is not Python 3.12; refusing to overwrite it."
}

& $uv pip install --python $pythonPath -r $requirements
if ($LASTEXITCODE -ne 0) { throw "Failed to install the Windows TTS dependencies." }
& $pythonPath -c "import kokoro, torch; expected='$Device'; available=torch.cuda.is_available(); assert expected != 'cuda' or available, 'CUDA is unavailable'; print(f'Kokoro ready; torch={torch.__version__}; cuda={available}')"
if ($Device -eq "cuda") {
  Write-Warning "CUDA Kokoro is validation-only on this host. start-local.ps1 deliberately uses the proven CPU profile because ASR overlap caused an unexpected host restart."
}
