# 03 - Execution Brief: Release Validation

**Status:** Accepted for implementation

**Target features:** FEAT-030 through FEAT-032

## Ordered work

| Order | Work | Feature |
|---|---|---|
| 1 | Implement pure ASR quality scoring and deterministic tests | FEAT-030 |
| 2 | Build/check the versioned 12-case zh/en/code-switch WAV corpus | FEAT-030 |
| 3 | Implement bounded production WebSocket quality/latency/terminal evaluator | FEAT-030–031 |
| 4 | Add GPU/thermal/power sampling and statistically qualified summaries | FEAT-031 |
| 5 | Add 100-turn deterministic terminal soak and >=20 production terminal turns | FEAT-031 |
| 6 | Implement operational stop/start/WSL recovery verifier with fail-closed guards | FEAT-032 |
| 7 | Run full deterministic, live-model, browser-evidence, capacity, and recovery gates | FEAT-030–032 |
| 8 | Synchronize runbook, findings, progress, handoff, machine report, and final evaluator report | FEAT-032 |
| 9 | Perform requirement-by-requirement completion audit and leave production healthy | FEAT-030–032 |

## Required thresholds

- Mandarin CER <= 0.35.
- English WER <= 0.30.
- Code-switch mixed token error <= 0.40.
- Key-term preservation >= 0.85 overall and no group below 0.75.
- Exact command correctness 100%.
- Deterministic routing 24/24 and policy 12/12.
- No empty ASR finals.
- Voice first-audio p50 <= 3 s and p95 <= 8 s.
- Human acoustic interruption <= 300 ms.
- Playback overrun 0; underrun rate <= 1%.
- Exactly one GPU ASR engine; peak board usage <= 8 GiB; >= 3.5 GiB headroom; temperature < 85 C.
- 100% legal, unique terminal outcomes in deterministic and production samples.
- All supported recovery and unsafe-profile refusal checks pass.
- p99 omitted unless n >= 1,000.

## Evaluator commands

```powershell
./scripts/npm.ps1 run test:all
./scripts/npm.ps1 run lint
./scripts/npm.ps1 run build
./scripts/npm.ps1 audit --audit-level=low
python scripts/generate-fixtures.py --check
python scripts/build-asr-corpus.py --check
python scripts/smoke-gateway.py
./scripts/preflight-wsl.ps1
python scripts/evaluate-release.py --url ws://127.0.0.1:8765/ws --output .runtime-data/release/release-evaluation.json
./scripts/verify-release.ps1
```

## Definition of Done

- All quality groups, safety controls, performance envelopes, terminal reliability, and recovery checks have direct recorded evidence.
- Limitations clearly distinguish fixed TTS regression speech from population-level human speech accuracy.
- Production remains on CPU Kokoro + singleton prewarmed GPU Qwen ASR and reports all health checks true.
- `stage-gates/04-verification-report.md` contains actual outputs and artifact hashes.
- Only the Evaluator may set FEAT-030 through FEAT-032 true.
