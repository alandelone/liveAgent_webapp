# Session Handoff: v0.2 Local Supervisor Replanning

## Current Stage

- `mission_status.json`: Phase 2 Discovery, Planner, in progress.
- Target: FEAT-014 through FEAT-017.
- Accepted architecture: the Local Supervisor is the primary orchestrator; Hermes is an optional escalation worker.
- First-release policy: read-only and explicitly allowlisted local reversible operations only; consequential actions return `BLOCKED_POLICY`; no approval protocol.

## Verified Baseline

- FEAT-001 through FEAT-013 remain passed only under their narrowed transport/UI prototype descriptions.
- Latest baseline check: 41/41 tests passed across 15 files; `npm run lint` reported 0 TypeScript errors.
- Historical evaluator evidence is archived in `stage-gates/archive/v0.1-verification-report.md`.
- The v1 bridge supports JSON handshake/replay and routes text/target requests to Hermes CLI profiles.

## Capabilities Not Yet Proven

- The active browser voice path uses Web Speech API and an `AnalyserNode`; it does not send AudioWorklet PCM.
- `server.py` discards inbound binary audio and does not run Silero VAD or Qwen3-ASR.
- Playback is simulated; no real TTS audio stream is produced.
- Acoustic barge-in, Local Supervisor routing, worker scheduling, canonical tracing, and 12 GB model co-residency remain pending.
- Existing code still contains hardcoded `hermes` orchestrator assumptions in state/manifest handling and component names.

## Documentation Decisions Completed

- ADR-008 supersedes the Hermes-only control-plane decision while preserving browser/backend separation.
- ADR-009 defers approval and defines deterministic `BLOCKED_POLICY` behavior.
- Product vision, project context, interaction design, voice pipeline, protocol, feature list, and Discovery gate now use Local Supervisor ownership.
- The protocol distinguishes implemented v1 behavior from v0.2 target semantics, including server-authoritative VAD and non-replayable binary audio.

## Remaining Discovery Work

1. Select and repair the Linux GPU runtime path: WSL2, GPU-enabled Linux container, or a measured split arrangement.
2. Freeze the next protocol version, compatibility window, audio framing/queue limits, replay overflow, and command acknowledgement rules.
3. Define trace redaction, retention, semantic sampling, and backpressure limits with volume estimates.
4. Define the deterministic audio/routing fixture taxonomy and statistical reporting method.
5. Name falsifiable experiments for every remaining hardware, routing-quality, acoustic, and transport hypothesis.

Do not advance to `02-tech-design.md` or mark FEAT-014 through FEAT-017 passed until the Discovery checklist and evaluator evidence are complete.

