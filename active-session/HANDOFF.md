# Session Handoff: v0.2.0 Complete

## Status

- Mission: complete; Evaluator gate passed.
- Features: FEAT-001 through FEAT-032 all pass.
- Production: running at `http://127.0.0.1:5173/live/`.
- Deployment: non-Docker Windows production-preview UI + Windows CPU Kokoro + one prewarmed Debian WSL GPU Qwen3-ASR engine.
- Chinese response-interruption command: `听我说`.

## Final evidence

- Mandarin CER 0.000; English WER 0.000; code-switch MER 0.087.
- Key terms, exact commands, deterministic routes/policies, and production terminal outcomes all pass.
- First audio p50 2604.404 ms; p95 2963.833 ms. p99 correctly omitted for fewer than 1,000 observations.
- Human acoustic interruption 0.100 ms; 0 playback underruns and overruns in the verified 193,200-frame Chrome response.
- GPU evidence: 6097 MiB used, 5898 MiB free, 47 C, one `VLLM::EngineCore`.
- Reliability: 100/100 deterministic legal terminals and 20/20 production legal terminals.
- Recovery: controlled stop released the engine and capacity; ordered restart restored TTS, UI, GPU isolation, and gateway health.
- Full verification: 63/63 frontend assertions, 44/44 Python tests, fixtures/corpus, lint, build, zero-vulnerability audit, and isolated gateway smoke passed.

## Artifacts

- `stage-gates/04-verification-report.md`
- `stage-gates/archive/v0.2-phase7-verification-report.md`
- `deployment/release-evidence.json`
- `deployment/recovery-evidence.json`
- `test-fixtures/v0.2/asr-corpus/manifest.json`

## Operating constraints

- Keep GPU reserved for Qwen ASR. Do not retry CUDA Kokoro plus WSL Qwen ASR on this host; that pairing caused a Kernel-Power 41 restart and startup now refuses it.
- Keep the deployment localhost/private-WSL-interface only. Public/TLS/authenticated hosting is outside v0.2.0.
- The fixed selected-TTS corpus is regression evidence, not population-level human speech accuracy.
- Use `scripts/npm.ps1` so verification runs on the pinned Node 24 toolchain instead of the host's Node 18.

No remaining work is required for the active goal.
