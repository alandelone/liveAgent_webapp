# Findings & Troubleshooting Guide

> Sections below record v0.1 implementation findings. Under ADR-008, `server.py` is a legacy protocol/CLI bridge to migrate into the Local Runtime Service; it is not the target orchestrator.

## 1. Hermes Dashboard Server vs. Voice Event Protocol
- **Finding**: Running `hermes serve` launches Hermes's internal FastAPI web dashboard (intended for the desktop UI / REST APIs on port 9119). It does not provide the `AGENT_MANIFEST` / `CLIENT_HELLO` real-time WebSocket protocol required by `livechat_agent`.
- **Historical solution**: Implemented `server.py` (`npm run server`) as the v1 protocol bridge on port 8765, which interacts directly with Hermes CLI and profiles (`hermes -z` / `hermes --profile <name> -z`). The v0.2 target replaces its control-plane role with the Local Supervisor and retains Hermes behind an escalation adapter.

## 2. Real-Time Speech Recognition in Voice Controller
- **Finding**: Without native speech-to-text integration, speech audio events (`USER_SPEECH_START`/`USER_SPEECH_END`) required a server-side transcription model or resulted in static responses.
- **Historical solution**: Integrated browser-native Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`) alongside Web Audio RMS tracking and forwarded completed text as `USER_TEXT`.
- **Limitation**: This is a browser-dependent prototype, not zero-latency evidence and not the target PCM → server Silero VAD → Qwen3-ASR path. Browser language support, accuracy, network behavior, and timing vary by implementation.

## 3. Dynamic Hermes Profile Synchronization
- **Finding**: Sub-agents hardcoded in JSON fixtures do not reflect real Hermes profiles created in `C:\Users\Alandelone\AppData\Local\hermes\profiles`.
- **Solution**: `server.py` scans `C:\Users\Alandelone\AppData\Local\hermes\profiles` on connection and uses `subagents.config.json` to enforce limits (`max_visible_subagents`) and visual theme overrides.

## 4. WSL2 Runtime Repair and Layered Model Dependencies

- **Finding**: The registered Ubuntu distro cannot start because its `ext4.vhdx` is missing. Docker Desktop's Linux engine is not a reliable fallback when it is stopped.
- **Solution**: Keep the broken registration untouched and use a fresh independent Debian WSL2 distro. Linux-side driver forwarding exposes the RTX 4070 Ti without installing a Linux display driver.
- **Finding**: The Debian 11 app included an obsolete `bullseye-backports` source that returns HTTP 404; bootstrap must remove only that source before `apt-get update`.
- **Finding**: Installing `silero-vad` pulls a multi-gigabyte Torch/CUDA stack. It is not a lightweight gateway dependency, and resolving it separately from vLLM can select a different Torch/CUDA generation and waste downloads.
- **Solution**: Keep `requirements-runtime.txt` gateway-only, then resolve `requirements-vad.txt` and `requirements-model.txt` together under the pinned Python 3.12 environment.
- **Finding**: If a Windows wrapper exits while `uv` continues inside WSL, the orphaned installer retains the virtual-environment lock and a later bootstrap appears hung.
- **Solution**: Check WSL processes before retrying; terminate only the known orphaned bootstrap/uv process, preserve the uv cache, then rerun the idempotent bootstrap.
- **Finding**: An interrupted Hugging Face Xet model download may recreate its `.incomplete` output at zero bytes on restart even though completed model shards remain cached. The temporary main-shard bytes are therefore not a reliable restart checkpoint.
- **Solution**: Set `HF_XET_HIGH_PERFORMANCE=1` before the first large model download when appropriate, verify disk space and connectivity up front, and do not restart a progressing model download merely to change Xet tuning. Treat only completed content-addressed blobs as durable cache entries.
## Hermes CLI one-shot is not a first-release execution boundary (2026-08-25)

- Local `hermes --help` states that one-shot `-z` mode loads tools/rules and auto-bypasses approvals.
- Therefore the Local Runtime must not wire raw user prompts to `hermes -z` under the first-release `BLOCKED_POLICY` promise.
- `runtime.hermes.HermesEscalationAdapter` remains a bounded, injected reasoning transport with deterministic tests, but deployment defaults to disabled until a separately audited read-only/no-tools transport exists.

## Full-duplex Windows/WSL deployment findings (2026-08-25)

- Mirrored WSL networking was not stable with the target vLLM ASR envelope; WSL restarted during the ASR load. Keep NAT networking and bind Windows Kokoro only to the dynamically discovered private WSL virtual-interface address.
- Qwen ASR and Qwen TTS could not co-reside safely on the 12 GB RTX 4070 Ti and Qwen TTS synthesis was not conversationally realtime. The selected topology is GPU Qwen ASR in Debian WSL plus isolated Windows Kokoro, with CPU Kokoro as the proven baseline.
- Vite's `/live/` base requires AudioWorklet assets to use `import.meta.env.BASE_URL`; root-relative worklet URLs fail in target Chrome even though unit tests and the page itself load.
- Chrome may deliver WebSocket binary messages as Blob or cross-realm buffers. Normalize them into same-realm ArrayBuffers on one serialized receive queue so PCM and following `TTS_END` markers cannot reorder.
- React development lifecycle cleanup can deactivate module-scoped controller subscriptions before its second mount. A reusable controller must re-activate subscriptions idempotently after cleanup.
- Sending synthesized 100 ms PCM chunks without pacing overflows the browser buffer. A 90 ms cadence plus next-clause synthesis prefetch delivered all 193,200 frames with no underrun or overrun in Chrome.
- Isolated Windows CUDA Kokoro is fast (209.752 ms median / 330.119 ms p95 warm), but its overlap with WSL vLLM Qwen ASR caused an unexpected full-host restart. Kernel-Power 41 and EventLog 6008 prove the unsafe boundary. Reserve the GPU for ASR and keep Kokoro on Windows CPU; isolated success is not co-residency proof.
- Vite development mode can advertise readiness while its dependency optimizer still blocks HTTP after a cold host boot. The deployment launcher must build first and serve `vite preview`; development mode remains for interactive coding only.
- Target Chrome applied 48 kHz mono capture with AEC, noise suppression, and automatic gain control all enabled. With live microphone capture during a full 193,200-frame response, speaker echo produced zero authoritative interruptions; an independent Windows playback sample was also rejected as output echo. Near-end speech must be tested with an actual human source because system-rendered audio is intentionally part of the AEC reference.
- Gateway integration smoke must use an isolated port. If it shares port 8765 with production, its readiness probe can attach to the existing real gateway before the spawned deterministic process reports its bind failure, producing misleading timeouts rather than deterministic evidence.
- Release evaluation must pad the final WAV read to the protocol's exact 640-byte/20 ms PCM frame. A valid WAV can end with a shorter read even though the capture protocol intentionally rejects partial frames.
- Measure first-audio latency from the server-authored `USER_SPEECH_END.timestamp` to local binary receipt. Draining buffered WebSocket events only after upload makes receive-loop monotonic timestamps collapse toward zero and is not valid latency evidence.
- Windows WDDM `nvidia-smi --query-compute-apps` includes unrelated desktop GPU clients. Count `VLLM::EngineCore` inside the Debian WSL process table when enforcing the singleton ASR-engine invariant; retain board-level memory and temperature from `nvidia-smi`.
- The final fixed-corpus run passed Mandarin CER 0.000, English WER 0.000, code-switch MER 0.087, first-audio p50 2604.404 ms and p95 2963.833 ms, with 100/100 deterministic and 20/20 production legal terminal outcomes. Recovery released ASR to zero engines and restored all four health checks.
