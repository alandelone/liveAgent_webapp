# 01 - Discovery Brief: Phase 2 Architecture, Platform & Evidence

**Status:** In progress

**Target features:** FEAT-014 through FEAT-017
**Gate rule:** No implementation work for Phase 2 begins until the unresolved decisions and completion checklist below are closed.

## Problem statement

The v0.1 repository proved a WebSocket/UI prototype, but its old feature descriptions and verification report overstated the live voice implementation. The v0.2 target adds a local Qwen Supervisor that routes work to a specialized agent pool, uses Hermes selectively for difficult work, accepts real Web App microphone PCM, and eventually returns real streaming speech.

Before implementing that target, Phase 2 must establish a non-contradictory architecture boundary, a supported GPU runtime, a trace/logging policy, and deterministic evidence infrastructure. Otherwise later latency, quality, safety, and VRAM conclusions would be unrepeatable.

## Accepted architecture decisions

- The **Local Supervisor is the primary orchestrator**. It owns routing, agent-pool tracking, task/job state, policy, cancellation, retries, response coordination, and escalation.
- Hermes is an optional heavy-reasoning/escalation worker. It is neither the browser's protocol peer nor the default router.
- The browser remains an acoustic/presentation client. Direct Agent Mode expresses a target preference and never bypasses Supervisor policy or tracing.
- The Web UI shows bounded public summaries; canonical internal trace/job logs remain available for debugging and performance review.
- These ownership decisions are independent of process packaging. WSL2/container/split topology remains open until measured.

## Verified facts

- The browser currently uses `SpeechRecognition`/`webkitSpeechRecognition` and `AnalyserNode`; it does not send AudioWorklet PCM.
- `HermesClient.sendAudio` exists, but the active voice controller does not call it.
- The Python bridge currently discards binary WebSocket messages.
- The current playback queue simulates timing/RMS and does not produce audible audio.
- `modeStore.ts`, `agentStateMachine.ts`, `manifestStore.ts`, and parts of transcript/constellation presentation still use the literal `hermes` ID as orchestrator behavior. The v0.2 migration must distinguish semantic hardcoding from harmless legacy class/theme names.
- Official Qwen3-ASR local streaming uses the vLLM backend; streaming timestamps are not available on that path.
- Official vLLM does not support native Windows. The target host needs WSL2 Linux or a GPU-enabled Linux container.
- The target RTX 4070 Ti reports 12,282 MiB total VRAM. A local observation found 2,420 MiB already in use, so model co-residency must include host/display baseline usage.
- The registered Ubuntu WSL instance failed to start because its `ext4.vhdx` was missing; Docker Desktop's Linux engine was not running during the same inspection.
- FEAT-001 through FEAT-013 retain historical pass status only under the narrowed prototype descriptions in `feature-list.json` and the archived v0.1 report.

## Hypotheses that require proof

| Hypothesis | Why it is uncertain | Required proof |
|---|---|---|
| Qwen3-ASR 1.7B and a local Supervisor can coexist on 12 GB VRAM | Weights are only part of usage; KV cache, activations, vLLM workspaces, TTS, display, and WSL/container overhead also consume memory | Repeated cold/warm overlap runs recording idle baseline, per-process delta, total-board peak, OOMs, and recovery |
| Qwen3 1.7B is accurate enough to route the agent pool | Model size and general benchmark quality do not prove this project's route, command, or policy decisions | Versioned labeled routing corpus with confusion matrix, failure analysis, and comparison against deterministic rules and at least one alternative configuration |
| WebSocket PCM is fast enough | Same-host and remote Web App deployments have different jitter, security, and buffering behavior | Frame-level timestamps under same-host and intended LAN/WAN topology, including p50/p95 and qualified tail measurements |
| Browser AEC is sufficient for full-duplex barge-in | Browser constraints are requests and behavior varies by browser, OS, speakers, room, and device | Applied-setting capture plus acoustic tests across supported browsers/devices, with push-to-talk fallback evidence |
| Strategic full trace logging is operationally affordable | Response chunks and worker telemetry can create high write volume and sensitive content | Log-volume benchmark, backpressure test, redaction review, retention calculation, and sampled semantic-review workflow |

## First-release safety boundary

- The first release permits read-only operations and explicitly allowlisted local reversible operations only.
- Externally visible, paid, irreversible, and high-impact actions return `BLOCKED_POLICY` and do not execute.
- `WAITING_APPROVAL` and the user-approval protocol are deferred and excluded from first-release states and acceptance criteria.
- Deterministic policy enforcement is required even if the Supervisor misclassifies a route.

## Target feature outcomes

### FEAT-014: Supervisor Runtime Boundary & Superseding ADR

- Define the local Supervisor as routing orchestrator and agent-pool tracker.
- Define Hermes as an escalation target rather than the only runtime.
- Define browser, bridge/voice service, Supervisor, workers, Hermes, and UI ownership.
- Replace or supersede contradictory red lines and synchronize product vision, project context, protocol, and design docs.
- Separate the implemented protocol-v1 baseline from the target migration, derive orchestrator identity from `AGENT_MANIFEST.isOrchestrator`, and enumerate legacy `hermes` ID assumptions as implementation debt.

### FEAT-015: Supported Linux GPU Runtime Preflight

- Repair/reprovision WSL2 Ubuntu or select a GPU-enabled Linux container.
- Verify Linux-side NVIDIA visibility and pin Python/CUDA/vLLM/Qwen dependencies.
- Complete a streaming Qwen3-ASR smoke test and record exact commands, versions, model revision, latency, and VRAM.

### FEAT-016: Canonical Trace Context & Strategic Logging Policy

- Freeze identifier semantics and propagation rules.
- Define required events, log levels, sampling, redaction, retention, backpressure, and export format.
- Prove that a task's delegation tree and retries can be reconstructed without exposing internal nodes to the Web UI.

### FEAT-017: Deterministic Voice Corpus & Benchmark Harness

- Define fixed audio/event fixture formats and labeling rules.
- Separate fast deterministic CI, offline model evaluation, target-hardware performance tests, and unscripted exploratory testing.
- Predeclare scoring, sample-size, confidence, and failure-report formats.

## Explicitly deferred

- User approval protocol and `WAITING_APPROVAL`.
- WebRTC transport.
- Streaming word-level timestamps.
- Final TTS engine selection; it must receive its own measured decision before FEAT-027 implementation.

## Open decisions requiring evidence or owner confirmation

- Exact runtime topology: all services in WSL2, Linux container(s), or a split Windows/Linux arrangement.
- Supervisor serving runtime and quantization candidates for the first co-residency benchmark.
- Initial logging retention and semantic-sample rate; these must be costed rather than guessed.
- Intended deployment topology for the Web App: localhost only, trusted LAN, or remote HTTPS/WSS.

## Discovery completion checklist

- [x] FEAT-014 superseding ADR direction accepted and contradictory documents enumerated in ADR-008 and the synchronized product, context, interaction, protocol, and voice-design documents.
- [ ] FEAT-015 runtime topology selected and the broken WSL/Docker state assigned a repair path.
- [ ] FEAT-016 trace/log policy includes measurable volume, privacy, retention, and backpressure limits.
- [ ] FEAT-017 fixture taxonomy, labels, and benchmark layers accepted.
- [x] First-release `BLOCKED_POLICY` scope accepted; `WAITING_APPROVAL` is absent from executable states and acceptance criteria and appears only as an explicitly deferred feature.
- [ ] Remaining assumptions have named experiments and falsifiable pass/fail evidence.
