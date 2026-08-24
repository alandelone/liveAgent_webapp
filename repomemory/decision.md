# Architecture Decision Records (ADRs) & Absolute Red Lines

---

## 🚫 Absolute Red Lines (绝对不能碰的红线)

1. **THE LOCAL SUPERVISOR IS THE PRIMARY ORCHESTRATOR.**
   - The backend Local Runtime Service owns intent classification, routing, job scheduling, agent-pool lifecycle, task tracking, retry/cancellation policy, and Hermes escalation. Hermes is an optional heavy-reasoning/escalation target, not the global controller. Browser code still must not implement orchestration.

2. **FRONTEND NEVER DECIDES DELEGATION.**
   - If the Local Supervisor delegates to Research, Coding, Browser, Hermes, or another worker, the frontend visualizes only public summaries. The frontend never chooses the execution route. Direct Agent Mode sends `targetAgentId` as intent to the Local Runtime Service; the Supervisor validates and routes it.

3. **OPTIMISTIC UI STATE WITH LOCAL RUNTIME RECONCILIATION.**
   - The frontend MAY predict local state transitions for immediacy (e.g. show "listening" on mic tap, stop TTS visuals on barge-in) without waiting for backend confirmation. Local Runtime events remain the source of truth. Task summaries, transcripts, and constellation membership are backend-driven; the browser does not infer internal Supervisor or worker activity.

4. **BARGE-IN DOES NOT CANCEL BACKGROUND WORK.**
   - Voice interruption (USER_INTERRUPT) stops TTS playback and in-flight voice generation only. Background tasks (file scanning, code execution, web scraping) continue undisturbed. "Stop speaking" ≠ "Stop task." Explicit task cancellation is a separate command (TASK_CANCEL).

5. **NO UI-BLOCKING AUDIO PIPELINE.**
   - Audio buffer decoding and streaming playback must operate asynchronously via AudioWorklet. UI frame drops during high-volume telemetry bursts are strictly unacceptable.

6. **NO PHANTOM GATES.**
   - No feature in `feature-list.json` may be updated to `passes: true` without evaluator test logs in `stage-gates/04-verification-report.md`.

7. **NO NON-DETERMINISTIC TEST RUNS.**
   - Automated tests must run self-contained against `test-fixtures/seed-data.json` without requiring live Hermes, external LLM API calls, live microphones, or manual human interventions.

8. **TASK TREE IS READ-ONLY.**
   - The task tree panel visualizes Local Supervisor execution summaries. It does not control the execution graph. No frontend-initiated task creation, reordering, or cancellation except through explicit Local Runtime commands.

9. **FIRST RELEASE BLOCKS CONSEQUENTIAL ACTIONS.**
   - The first release permits read-only operations and explicitly allowlisted local reversible operations only. Externally visible, paid, irreversible, and high-impact actions must return `BLOCKED_POLICY`. `WAITING_APPROVAL` and approval protocol events are deferred.

---

## ADR-001: Hermes Voice UI — Presentation Wrapper, Not Agent Runtime
- **Status**: Superseded by ADR-008 on 2026-08-25
- **Context**: The project needs a web interface for real-time voice collaboration with the Hermes agent backend. Early naming ("Multi-Agent Interface") risked developers accidentally building orchestration logic into the UI.
- **Decision**: `livechat_agent` is architecturally a **Hermes Voice UI** — an independent client-side React 19 + TypeScript web application that captures user input, renders Hermes output/state, and provides spatial visualization of Hermes's internal agent activity. Hermes owns all reasoning, tool execution, delegation, and task management.
- **Consequences**: Clear separation of concerns. The interface can be developed, styled, and verified independently via deterministic fixtures and recorded session replays.
- **Supersession note**: The browser-side separation remains valid, but the repository now also owns a Local Runtime Service. Hermes no longer owns all routing and task management.

---

## ADR-002: Full-Duplex WebSocket with Sequencing & Versioning
- **Status**: Accepted; JSON baseline implemented, binary audio target pending
- **Context**: Real-time voice interaction requires low-latency bi-directional audio streaming and structured event delivery. Network drops on mobile are frequent, and protocol evolution between Hermes and the frontend must not cause silent incompatibility.
- **Decision**: Use one full-duplex WebSocket for JSON event envelopes and directional binary audio. Replayable server JSON events carry a monotonic `seq`; handshake includes `protocolVersion`; unknown event types are ignored for forward compatibility. Binary audio is ephemeral and is never implied to be replayable through `lastSeq`.
- **Consequences**: Reconnection can detect and replay retained JSON gaps, while partial capture/playback streams require explicit restart/reconciliation. Version negotiation must prevent old clients from silently applying new VAD or cancellation semantics.

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
- **Decision**: Display the active orchestrator from `AGENT_MANIFEST` as the center orb plus only currently active/relevant workers. For v0.2 the orchestrator is the Local Supervisor; Hermes appears only when active as an escalation worker. Dormant workers stay hidden. No hardcoded orchestrator ID or agent identities.
- **Consequences**: Clean spatial UI at any agent count. Frontend is fully backend-agnostic regarding which agents exist.

---

## ADR-005: Echo Cancellation & Multi-Modal Input
- **Status**: Accepted
- **Context**: Without echo cancellation, voice-service TTS audio output triggers VAD, creating an infinite self-interruption loop. Additionally, automatic VAD fails in noisy environments, and voice is the wrong modality for code snippets, URLs, and filenames.
- **Decision**: Request browser AEC/NS/AGC, record the applied settings, and verify behavior with supported browser/device acoustic tests. Keep server-side VAD authoritative and provide headset/push-to-talk plus text fallback. Voice-first ≠ voice-only.
- **Consequences**: The product works in real-world conditions (speakerphone, noisy rooms, microphone permission failures) instead of only in demo environments.

---

## ADR-006: Deterministic Replay as Development Accelerator
- **Status**: Accepted
- **Context**: The mock server (FEAT-003) was originally positioned as a test-only tool at the end of the feature list. Recorded Local Runtime sessions can replay Supervisor routing, worker execution, Hermes escalation, voice output, interruption, and reconnection without loading live models.
- **Decision**: Keep mock/replay in the verified baseline and extend it with canonical trace context and deterministic v0.2 fixtures before real model integration.
- **Consequences**: UI and orchestration development can proceed against deterministic event traces while model quality and hardware performance remain separate evidence tracks.

---

## ADR-007: First-Audio Latency as Core KPI
- **Status**: Accepted
- **Context**: The product's core promise is that voice interaction feels like conversation, not dictation. This requires measuring and optimizing the time from user speech end to first audible response.
- **Decision**: Instrument the full path to track: `speech_end → Local Runtime receives turn`, `ASR final/stable text → Supervisor route`, `route → first text delta`, `first text delta → first audio chunk`, and `speech_end → first audible response` end to end. Also track queue wait, worker/Hermes duration, audio underruns, reconnects, interruption latency, and state inconsistencies.
- **Consequences**: Voice quality issues reported as "it feels laggy" can be diagnosed with data. Latency regressions are caught early.

---

## ADR-008: Local Supervisor as Primary Orchestrator
- **Status**: Accepted (2026-08-25)
- **Context**: The target product requires a low-latency local Supervisor that routes requests to a specialized agent pool, tracks job state, supports local/offline work, and escalates only difficult reasoning to Hermes. ADR-001 placed all orchestration in Hermes and therefore cannot describe this target.
- **Decision**: `livechat_agent` becomes a two-boundary system: a browser Web UI and a backend Local Runtime Service. Qwen3 1.7B is the initial Supervisor candidate. The Local Runtime Service owns routing, agent-pool scheduling, task/job state, tracing, policy enforcement, cancellation, retries, response coordination, and Hermes escalation. Hermes is a worker/escalation adapter. The browser remains presentation/acoustic-only and never runs the Supervisor or workers.
- **Consequences**: Lower expected local control latency and reduced default cloud dependency, at the cost of building and operating a real orchestration service. The old Hermes-only invariant is retired. Protocol and UI must become orchestrator-identity-agnostic; existing `hermes` identifiers are legacy compatibility details until a versioned migration is implemented.

---

## ADR-009: No Approval Workflow in the First Release
- **Status**: Accepted (2026-08-25)
- **Context**: A complete approval workflow requires request/decision protocol events, exact action previews, expiry, revision binding, reconnect recovery, and UI/voice interaction. It would expand the first release materially.
- **Decision**: Do not implement `WAITING_APPROVAL` in the first release. Deterministic execution policy permits only read-only operations and explicitly allowlisted local reversible operations. Consequential actions return `BLOCKED_POLICY` without execution. Supervisor classification is advisory; the execution adapter enforces the block.
- **Consequences**: The first release has a smaller safety surface but fewer capabilities. Existing safety mechanisms cannot substitute for an approval workflow unless separately audited. Approval remains a deferred feature and must not be implied by current acceptance criteria.
