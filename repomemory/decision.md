# Architecture Decision Records (ADRs) & Absolute Red Lines

---

## 🚫 Absolute Red Lines (绝对不能碰的红线)

1. **NO DIRECT LOCAL OS MUTATIONS**:
   - `livechat_agent` must NOT implement direct filesystem writes, shell commands, or process execution. All capabilities flow through the Hermes backend protocol.
2. **NO PHANTOM GATES**:
   - No feature in `feature-list.json` may be updated to `passes: true` without evaluator test logs in `stage-gates/04-verification-report.md`.
3. **NO NON-DETERMINISTIC TEST RUNS**:
   - Automated tests must run self-contained against `test-fixtures/seed-data.json` without requiring live external LLM API calls, live microphones, or manual human interventions.
4. **NO UI-BLOCKING AUDIO PIPELINE**:
   - Audio buffer decoding and streaming playback must operate asynchronously; UI frame drops during high-volume subagent telemetry bursts are strictly unacceptable.

---

## ADR-001: Interface Wrapper Architecture & Separation of Concerns
- **Status**: Accepted
- **Context**: The user requires a web interface for real-time voice & text collaboration that connects to Hermes agent backend. Hermes controls execution, local file tools, and subagents on the workstation.
- **Decision**: `livechat_agent` is built as an independent client-side React 19 + TypeScript web application, acting as the presentation and real-time streaming wrapper for Hermes.
- **Consequences**: Clear separation of concerns; interface can be developed, styled, and verified independently via deterministic fixtures.

---

## ADR-002: Full-Duplex WebSocket Streaming Protocol
- **Status**: Accepted
- **Context**: Real-time voice interaction requires low latency bi-directional audio streaming, simultaneous textual transcription, tool invocation events, and subagent state updates.
- **Decision**: Implement a unified full-duplex WebSocket connection handling both binary audio frames (PCM/Opus chunks) and structured JSON event envelopes (`transcript`, `subagent_spawn`, `subagent_update`, `tool_call`, `error`).
- **Consequences**: Single socket lifecycle simplifies reconnection, barge-in synchronization, and latency management.

---

## ADR-003: 3-Pane Swappable Spatial Layout with Satellite Subagent Orbs
- **Status**: Accepted
- **Context**: The user requested a 3-pane layout capable of swapping left/right: Middle (Central voice orb + dynamic satellite orbs for subagents), Left (Chat transcripts & markdown), Right (Multi-Agent Task Tree & parallel logs).
- **Decision**: Build a modular 3-pane flex/grid layout where panels can swap positions or collapse. The central voice visualizer dynamically spawns orbit/satellite orbs corresponding to active subagents emitted by Hermes.
- **Consequences**: High visual feedback on multi-agent execution while maintaining clear conversational context and detailed inspectability.

---

## ADR-004: Deterministic Sandbox via Mock Hermes Server
- **Status**: Accepted
- **Context**: CI and Evaluator agents require repeatable, deterministic test runs to verify all 7 features in `feature-list.json` without physical audio devices or live API keys.
- **Decision**: Include a standalone deterministic Mock Hermes WebSocket Server that replays `test-fixtures/seed-data.json` with realistic event intervals and mock audio streams.
- **Consequences**: Evaluator can automatically verify connection, audio streaming, UI updates, subagent lifecycle transitions, and error handling in headless Playwright / Vitest test runs.
