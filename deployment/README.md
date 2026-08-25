# Localhost Deployment

The first supported deployment is Windows browser/Vite plus Windows TTS and GPU ASR/gateway services inside the `Debian` WSL2 distribution. Browser and gateway bind loopback. TTS binds only loopback or the private Windows WSL virtual interface. Docker Desktop and the broken `Ubuntu` registration are not dependencies.

## Bootstrap

Run from PowerShell:

```powershell
./scripts/bootstrap-node.ps1
./scripts/bootstrap-wsl.ps1
./scripts/preflight-wsl.ps1
```

The bootstrap is idempotent, creates the unprivileged `liveagent` account, installs pinned `uv`, provisions CPython 3.12 in `/opt/livechat-agent/.venv`, and installs the lightweight gateway dependencies. VAD and model packages are intentionally separate because Silero's default Torch stack alone downloads several gigabytes of CUDA wheels:

```powershell
./scripts/bootstrap-wsl.ps1 -IncludeModels
```

Provision the measured Windows Kokoro realtime environment and optional WSL Qwen validation environment:

```powershell
./scripts/bootstrap-wsl.ps1 -IncludeTts
./scripts/bootstrap-tts-windows.ps1
# Optional candidate; it is not promoted until the overlap smoke passes.
./scripts/bootstrap-tts-windows.ps1 -Device cuda
```

Rollback removes `/opt/livechat-agent/.venv` and the model cache owned by `liveagent`; it does not unregister a WSL distribution or touch Windows Node dependencies.

## Development verification

```powershell
./scripts/npm.ps1 ci
./scripts/npm.ps1 run test:all
./scripts/npm.ps1 run lint
./scripts/npm.ps1 run build
python scripts/generate-fixtures.py --check
./scripts/preflight-wsl.ps1
```

## Security boundary

Use only `127.0.0.1` URLs. Do not expose the gateway/model ports to LAN or Internet. Remote deployment requires a separate TLS/authentication/origin design and is not part of the first release.

## Model evidence

Before FEAT-015 can pass, record the immutable model revision, three cold plus ten warm streaming transcriptions, latency, Windows idle GPU baseline, per-process/board VRAM peaks, OOM behavior, and recovery. Installing packages alone is not model smoke-test evidence.

For the initial multi-gigabyte model cache, set `HF_XET_HIGH_PERFORMANCE=1` before starting if the host should use parallel Xet transfers. Do not interrupt a healthy `.incomplete` download to change this setting: completed blobs survive, but an incomplete large shard may be recreated from zero on the next process start.

## One-command local deployment

The supported launcher discovers the current WSL NAT host address, verifies it belongs to the Windows WSL virtual interface, enforces the host-memory preflight, starts services in dependency order, verifies provenance/connectivity, and records PIDs:

```powershell
./scripts/start-local.ps1
./scripts/status-local.ps1
```

Open `http://127.0.0.1:5173/live/`. Stop only the recorded and command-line-validated processes with:

```powershell
./scripts/stop-local.ps1
```

Logs remain under `.runtime-data/logs`. Do not enable WSL mirrored networking on this target: isolated Qwen ASR caused the Debian VM to restart under mirrored mode. NAT plus the dedicated WSL virtual-interface bind is the verified topology.

## Runtime capacity profiles

The verified voice envelope is one active stream, 4096 model tokens, one audio item and sequence, 1024 batched tokens, eager execution, a fixed 512 MiB KV cache, and vLLM single-process mode. Start the runtime inside Debian so the pinned Silero/Qwen packages and Linux vLLM backend are used:

```powershell
wsl.exe -d Debian -u liveagent -- bash -lc 'cd /mnt/c/Users/Alandelone/CodeSpace_Local/livechat_agent && set -a && source deployment/voice.env && set +a && /opt/livechat-agent/.venv/bin/python server.py'
```

The target host passed isolated Qwen3-1.7B Supervisor BF16 and NF4 comparisons, but every ASR/Supervisor co-residency order failed through GPU allocator incompatibility or Windows commit exhaustion. The gateway therefore refuses the unsafe pair. Use the explicit Supervisor-only profile when validating/model-serving text routes:

```powershell
wsl.exe -d Debian -u liveagent -- bash -lc 'cd /mnt/c/Users/Alandelone/CodeSpace_Local/livechat_agent && set -a && source deployment/supervisor.env && set +a && /opt/livechat-agent/.venv/bin/python server.py'
```

The 1.3 GiB local NF4 artifact is derived only from official revision `70d244cc86ccca08cf5af4e1e306ecf908b1ad5e` by `scripts/export-supervisor-nf4.py`; `source-manifest.json` is validated before load. Recreate it with:

```powershell
wsl.exe -d Debian -u liveagent -- bash -lc 'cd /mnt/c/Users/Alandelone/CodeSpace_Local/livechat_agent && PYTHONPATH=. /opt/livechat-agent/.venv/bin/python scripts/export-supervisor-nf4.py --output /opt/livechat-agent/models/qwen3-supervisor-nf4'
```

For deterministic gateway development without GPU inference, use energy/fake adapters. Production selection never silently falls back to a fake backend, and Hermes remains disabled until a read-only/no-tools transport is audited.

## TTS profiles

The realtime backend is official Apache-2.0 `hexgrad/Kokoro-82M-v1.1-zh` revision `01e7505bd6a7a2ac4975463114c3a7650a9f7218`. The Windows CPU profile generated nine Chinese/English/code-switch samples with 0.821-second median and 1.318-second p95 synthesis/first-audio latency. A real simultaneous Qwen ASR/CPU-Kokoro run passed at 7,357 MiB board peak with 4,925 MiB headroom. The launcher always uses this proven profile.

The optional Windows CUDA profile passed 9/9 isolated cases after the fixed voice packs were kept on CPU for Kokoro 0.9.4 compatibility. Warm synthesis measured 209.752 ms median and 330.119 ms p95. It is deliberately **not** a deployment profile: starting Qwen ASR while CUDA Kokoro was resident caused an unexpected Windows shutdown at 20:28:35, recorded by Kernel-Power 41 and EventLog 6008. GPU capacity is therefore reserved for Qwen ASR; do not run `venv-tts-gpu` alongside the voice gateway on this host. Startup refuses this combination and the status check reports degraded GPU isolation if it is introduced afterward.

Target Chrome consumed all 82 correlated chunks / 193,200 frames for the bilingual live response with nonzero RMS, zero underrun and zero overrun. The gateway paces each 100 ms payload at 90 ms and prefetches the next clause so the bounded two-second browser buffer neither starves nor drops speech.

The service accepts only bounded text and fixed Chinese/English speaker pairs; it does not expose voice cloning, arbitrary instructions, model selection, or remote/LAN binds. Its private-interface mode requires an explicit flag and the adapter accepts only literal local/private IPv4 endpoints.

## Release verification and recovery

Run the fixed bilingual/code-switch production evaluator against an already healthy stack, then perform the controlled stop/capacity-release/start recovery drill:

```powershell
python scripts/build-asr-corpus.py --check
python scripts/evaluate-release.py
./scripts/verify-release.ps1
./scripts/status-local.ps1
```

Machine-readable proof is written to `deployment/release-evidence.json` and `deployment/recovery-evidence.json`; the signed-off results and hashes are recorded in `stage-gates/04-verification-report.md`. The Chinese response-interruption command is `听我说`.

### Qwen TTS validation-only profile

The official TTS candidate is pinned to `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` revision `85e237c12c027371202489a0ec509ded67b5e4b5`. Start its fixed-model loopback service from the isolated environment:

```powershell
wsl.exe -d Debian -u liveagent -- bash -lc 'cd /mnt/c/Users/Alandelone/CodeSpace_Local/livechat_agent && /opt/livechat-agent/.venv-tts/bin/python scripts/qwen-tts-service.py --device cuda:0'
```

Then start the gateway using `deployment/tts-validation.env`. Qwen TTS is not a realtime deployment backend: measured synthesis took 5.86–10.02 seconds and both Qwen ASR/Qwen TTS co-residency orders failed. Startup refuses that pair unless a future target-host gate explicitly proves it safe.
