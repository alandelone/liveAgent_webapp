# Architecture Decision Records (ADRs) & Absolute Red Lines

---

## 🚫 Absolute Red Lines (绝对不能碰的红线)

1. **HERMES IS THE ONLY AGENT RUNTIME.**
   - `livechat_agent` must NOT implement reasoning, tool execution, delegation decisions, subagent lifecycle management, or file operations. All intelligence flows through Hermes. The center orb is a visual representation of Hermes, not a frontend orchestrator.

2. **FRONTEND NEVER DECIDES DELEGATION.**
   - If Hermes delegates to Research, Coding, or Browser, the frontend visualizes it. The frontend never chooses which agent receives work. In Direct Agent Mode, the frontend sends `targetAgentId` to Hermes — it does not bypass Hermes infrastructure.

3. **OPTIMISTIC UI STATE WITH HERMES RECONCILIATION.**
   - The frontend MAY predict local state transitions for immediacy (e.g. show "listening" on mic tap, stop TTS visuals on barge-in) without waiting for Hermes confirmation. However, Hermes events remain the source of truth — when a Hermes state event arrives, the frontend reconciles to match it. Task trees, transcripts, and constellation membership are still driven by Hermes events. No local UI guesses about what Hermes might be doing.

4. **BARGE-IN DOES NOT CANCEL BACKGROUND WORK.**
   - Voice interruption (USER_INTERRUPT) stops TTS playback and in-flight voice generation only. Background tasks (file scanning, code execution, web scraping) continue undisturbed. "Stop speaking" ≠ "Stop task." Explicit task cancellation is a separate command (TASK_CANCEL, deferred).

5. **NO UI-BLOCKING AUDIO PIPELINE.**
   - Audio buffer decoding and streaming playback must operate asynchronously via AudioWorklet. UI frame drops during high-volume telemetry bursts are strictly unacceptable.

6. **NO PHANTOM GATES.**
   - No feature in `feature-list.json` may be updated to `passes: true` without evaluator test logs in `stage-gates/04-verification-report.md`.

7. **NO NON-DETERMINISTIC TEST RUNS.**
   - Automated tests must run self-contained against `test-fixtures/seed-data.json` without requiring live Hermes, external LLM API calls, live microphones, or manual human interventions.

8. **TASK TREE IS READ-ONLY.**
   - The task tree panel visualizes Hermes execution. It does not control the execution graph. No frontend-initiated task creation, reordering, or cancellation (except through explicit Hermes protocol commands).

---

## ADR-001: Hermes Voice UI — Presentation Wrapper, Not Agent Runtime
- **Status**: Accepted
- **Context**: The project needs a web interface for real-time voice collaboration with the Hermes agent backend. Early naming ("Multi-Agent Interface") risked developers accidentally building orchestration logic into the UI.
- **Decision**: `livechat_agent` is architecturally a **Hermes Voice UI** — an independent client-side React 19 + TypeScript web application that captures user input, renders Hermes output/state, and provides spatial visualization of Hermes's internal agent activity. Hermes owns all reasoning, tool execution, delegation, and task management.
- **Consequences**: Clear separation of concerns. The interface can be developed, styled, and verified independently via deterministic fixtures and recorded session replays.

---

## ADR-002: Full-Duplex WebSocket with Sequencing & Versioning
- **Status**: Accepted
- **Context**: Real-time voice interaction requires low-latency bi-directional audio streaming and structured event delivery. Network drops on mobile are frequent, and protocol evolution between Hermes and the frontend must not cause silent incompatibility.
- **Decision**: Single full-duplex WebSocket multiplexing binary audio frames (PCM/Opus) and JSON event envelopes. Every event carries a monotonic `seq` number for gap detection on reconnect. Initial handshake includes `protocolVersion`. Unknown event types are gracefully ignored for forward compatibility.
- **Consequences**: Reconnection can detect and replay missed events via seq gaps. Protocol can evolve without breaking older frontends. Single socket lifecycle simplifies barge-in synchronization.

---

## ADR-003: WebSocket First — No WebRTC Unless Measurements Demand It
- **Status**: Accepted
- **Context**: WebRTC offers lower audio latency but adds significant complexity (STUN/TURN, ICE negotiation, codec negotiation). The spec mentions WebRTC as an option.
- **Decision**: Use WebSocket for v0.1. Design the audio transport as a **replaceable adapter** so the swap to WebRTC is cheap if end-to-end latency measurements prove WebSocket is insufficient.
- **Consequences**: Simpler initial implementation. Latency measurement infrastructure (ADR-007) will provide the data to justify or dismiss a WebRTC migration.

---

## ADR-004: Active Constellation — Dynamic Agent Display
- **Status**: Accepted
- **Context**: If Hermes exposes many agents (15+), showing them all as permanent orbs creates visual noise and an unusable interface.
- **Decision**: Display the Hermes center orb plus only currently active/relevant side agents. Dormant agents stay hidden until Hermes invokes them. Agents that Hermes creates at runtime appear dynamically; agents that go dormant fade out. No hardcoded agent identities — the constellation is generated entirely from the AGENT_MANIFEST event.
- **Consequences**: Clean spatial UI at any agent count. Frontend is fully backend-agnostic regarding which agents exist.

---

## ADR-005: Echo Cancellation & Multi-Modal Input
- **Status**: Accepted
- **Context**: Without echo cancellation, Hermes's TTS audio output triggers the frontend's VAD, creating an infinite self-interruption loop. Additionally, automatic VAD fails in noisy environments, and voice is the wrong modality for code snippets, URLs, and filenames.
- **Decision**: Implement client-side echo cancellation / self-trigger protection. Provide push-to-talk as a fallback input mode. Provide text input as a second fallback. Voice-first ≠ voice-only.
- **Consequences**: The product works in real-world conditions (speakerphone, noisy rooms, microphone permission failures) instead of only in demo environments.

---

## ADR-006: Deterministic Replay as Development Accelerator
- **Status**: Accepted
- **Context**: The mock server (FEAT-003) was originally positioned as a test-only tool at the end of the feature list. However, recorded real Hermes sessions can be replayed to enable frontend development without running Hermes at all.
- **Decision**: Promote the mock/replay system to Phase 0 (Foundation). Add a session recorder that captures real Hermes sessions as timestamped JSONL traces. Frontend developers can simulate Hermes speaking, delegating, agents working/failing, user interrupting, and reconnection — all from recorded traces.
- **Consequences**: Frontend development velocity is decoupled from Hermes availability. UI iteration is 10x faster. Test coverage is built on real interaction patterns.

---

## ADR-007: First-Audio Latency as Core KPI
- **Status**: Accepted
- **Context**: The product's core promise is that voice interaction feels like conversation, not dictation. This requires measuring and optimizing the time from user speech end to first audible response.
- **Decision**: Instrument the client to track: `speech_end → Hermes receives turn`, `Hermes → first text delta`, `first text delta → first audio chunk`, and `speech_end → first audible response` (end-to-end). Also track audio underruns, reconnect counts, event latency, interruption latency, and state inconsistencies.
- **Consequences**: Voice quality issues reported as "it feels laggy" can be diagnosed with data. Latency regressions are caught early.
