# 04 - Verification Report: Release Validation

**Status:** Passed

**Evaluator date:** 2026-08-25

**Features:** FEAT-030, FEAT-031, FEAT-032

## Decision

Release Validation passes. The measured deployment is the non-Docker Windows/WSL profile: production-preview UI and pinned CPU Kokoro on Windows, with one prewarmed Qwen3-ASR vLLM engine on the RTX 4070 Ti in Debian WSL. CUDA Kokoro remains rejected and startup guards prevent the unsafe GPU TTS/ASR pairing.

## Quality evidence

| Measure | Requirement | Result |
|---|---:|---:|
| Mandarin CER | <= 0.35 | 0.000 |
| English WER | <= 0.30 | 0.000 |
| Code-switch MER | <= 0.40 | 0.087 |
| Key-term accuracy | >= 0.85 overall; >= 0.75/group | 1.000 overall; 1.000/group |
| Exact command accuracy | 100% | 100% |
| Deterministic routes | 24/24 | 24/24 |
| Deterministic policies | 12/12 | 12/12 |
| Empty ASR finals | 0 | 0 |
| Voice/worker terminal outcomes | 100% | 12/12 |

The fixed corpus contains four Mandarin, four English, and four natural code-switch cases. The selected-TTS corpus is a repeatable regression set, not a population-level human speech claim. The requested Chinese interruption phrase is `听我说`; it transcribed as `听我说。` and matched `STOP_SPEAKING` exactly after normalization.

## Performance and reliability evidence

| Measure | Requirement | Result |
|---|---:|---:|
| First audio p50 | <= 3000 ms | 2604.404 ms |
| First audio p95 | <= 8000 ms | 2963.833 ms |
| Human acoustic interruption | <= 300 ms | 0.100 ms |
| Playback overrun | 0 | 0 |
| Playback underrun | <= 1% | 0/193,200 frames |
| GPU board usage | <= 8192 MiB | 6097 MiB |
| GPU headroom | >= 3584 MiB | 5898 MiB |
| GPU temperature | < 85 C | 47 C |
| GPU ASR engines | exactly 1 | 1 |
| Deterministic soak | 100% legal terminals | 100/100 |
| Production sample | >= 20, 100% legal terminals | 20/20 (12 voice + 8 text) |

p99 is intentionally omitted because the live sample is below the required 1,000 observations. Human Chrome evidence also recorded actual 48 kHz mono capture with echo cancellation, noise suppression, and automatic gain control enabled; the full playback completed without echo self-interruption.

## Deterministic and operational gates

- Frontend: 18/18 files, 63/63 assertions passed.
- Python runtime: 44/44 tests passed.
- Versioned fixtures and 12-WAV ASR corpus hash checks passed.
- TypeScript lint and production Vite build passed (1595 modules; 281.51 kB JS, 80.46 kB gzip).
- Dependency audit found 0 vulnerabilities.
- Isolated deterministic gateway smoke passed, including correlated PCM, authoritative-VAD interruption ordering, policy block, and protocol rejection.
- Controlled stop/capacity-release/start recovery passed: 0 ASR engines while stopped, 13.737 GiB physical and 11.777 GiB commit free before restart, then all TTS/UI/GPU-isolation/gateway health checks true.
- Runtime tests prove unverified Qwen ASR plus GPU TTS overlap is refused.
- Final deployment health is `running`; CPU Kokoro, production-preview UI, GPU isolation, and gateway checks are all true. Post-restart WSL has one `VLLM::EngineCore` process.

## Artifacts

- `deployment/release-evidence.json`: SHA-256 `1101546FA07BBF500C83780F8DF0EDE98C19C5C1301E2EFF2F77B061A23731DD`.
- `deployment/recovery-evidence.json`: SHA-256 `6F7783EDC8EDE3F15976F7163E146A4F5D0A263D419BA79B6C28134BF5089D77`.
- `test-fixtures/v0.2/asr-corpus/manifest.json`: SHA-256 `F3FE5C3020EF375627570DBC228A4CE606E995FFDFF81FC2E53C6774E52B0500`.

## Evaluator conclusion

All Phase 7 acceptance thresholds with applicable sample sizes pass. FEAT-030 through FEAT-032 may be marked true. The v0.2 release goal is complete and production is left healthy.
