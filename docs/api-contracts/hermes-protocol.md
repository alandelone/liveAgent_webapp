# Web UI ↔ Local Runtime Real-Time Event Protocol

> **Legacy filename:** `hermes-protocol.md` is retained temporarily so existing links do not break. The protocol peer is now the **Local Runtime Service**. Hermes is an internal escalation adapter and does not own the browser session.

## 1. Contract Status

This document separates verified v1 behavior from the v0.2 target. It must not be read as proof that the target voice pipeline is implemented.

### Implemented v1 baseline

- `protocolVersion: 1` handshake with `CLIENT_HELLO` and `AGENT_MANIFEST`.
- Server-event sequence numbers, reconnect with `lastSeq`, heartbeat/liveness handling, and deterministic JSONL replay tests.
- Schema/client/fixture coverage for user text/target intent, transcript/state/text markers, task summaries, and TTS start/end markers; this does not prove that every event is produced by the live bridge.
- The endpoint defaults to `ws://127.0.0.1:8765/ws`. `VITE_HERMES_WS_URL` is a legacy configuration name.

### Not implemented by the v1 evidence

- The active browser controller does not send AudioWorklet PCM.
- The Python bridge discards incoming binary frames.
- Server-side Silero VAD and Qwen3-ASR are not connected.
- TTS markers do not carry real synthesized audio, and the playback queue simulates timing rather than producing audible output.
- The current UI/state code still contains `hermes` orchestrator-ID assumptions.

All audio, Supervisor, policy, cancellation, and trace rules below are **v0.2 target requirements** until their feature gates pass. The next protocol version number and compatibility window will be frozen in the Phase 2 technical design; clients must not silently reinterpret v1 messages as the new semantics.

## 2. Ownership Boundary

- The browser owns capture controls, the browser acoustic front end, playback, and public presentation state.
- The Local Runtime owns authoritative VAD, ASR, Supervisor routing, task/job state, deterministic policy, cancellation, response coordination, TTS, and event truth.
- Hermes receives only explicitly escalated work from the Local Runtime. The browser never addresses a Hermes control plane directly.
- The UI receives public transcript, agent, response, and task projections. It does not receive the complete internal route/job graph.

## 3. Connection and Handshake

The first transport target is one full-duplex WebSocket per browser session. Text frames contain JSON events; binary frames carry non-replayable audio. Remote deployment requires HTTPS/WSS and an explicit authentication design; localhost behavior must not be generalized to an untrusted network.

```json
{
  "type": "CLIENT_HELLO",
  "protocolVersion": 1,
  "sessionId": "sess_001",
  "lastSeq": null,
  "capabilities": ["audio_pcm_s16le_16k_mono"]
}
```

The Local Runtime answers with an `AGENT_MANIFEST` and replays available JSON events with `seq > lastSeq`. Version mismatch must produce an explicit protocol error rather than best-effort field guessing.

## 4. Public Event Envelope

Every replayable Runtime → browser JSON event carries:

```json
{
  "type": "EVENT_TYPE",
  "seq": 1521,
  "sessionId": "sess_001",
  "timestamp": 1787625600000
}
```

| Field | Purpose |
|---|---|
| `type` | Versioned event discriminator. |
| `seq` | Monotonically increasing server-event sequence within the session. |
| `sessionId` | Stable conversation identifier across reconnects. |
| `timestamp` | Unix epoch milliseconds from the Local Runtime clock. |
| `turnId` | Included when the event belongs to one user/response turn. |
| `taskId` | Included when the event is a public projection of one logical task. |

The browser validates known events and ignores unknown event types for forward compatibility. A malformed known event is logged and rejected without crashing the UI.

`traceId`, `revisionId`, `jobId`, `parentJobId`, `routeId`, and `attempt` remain internal by default. They are available in structured backend logs, not exposed merely because debugging data exists.

## 5. Agent Manifest and Orchestrator Identity

```json
{
  "type": "AGENT_MANIFEST",
  "seq": 1,
  "sessionId": "sess_001",
  "timestamp": 1787625600000,
  "agents": [
    {
      "id": "supervisor",
      "name": "Supervisor",
      "color": "#6366F1",
      "icon": "brain",
      "isOrchestrator": true
    },
    {
      "id": "research",
      "name": "Research",
      "color": "#A855F7",
      "icon": "book-open",
      "isOrchestrator": false
    },
    {
      "id": "hermes",
      "name": "Hermes",
      "color": "#F59E0B",
      "icon": "sparkles",
      "isOrchestrator": false
    }
  ]
}
```

- Exactly one active manifest entry must have `isOrchestrator: true`.
- The center orb is derived from that flag, never from `id === "hermes"`.
- Hermes is displayed only when relevant/active like any other worker.
- Manifest updates may add, retire, or change public worker descriptors, but must not expose private tool or routing policy.

Current semantic assumptions in `modeStore.ts`, `agentStateMachine.ts`, `manifestStore.ts`, `TranscriptPanel.tsx`, and constellation/orb presentation tests still treat `hermes` specially. Legacy class names or color tokens are cosmetic; any behavior that uses the literal ID to identify the orchestrator is a migration gap covered by FEAT-014/FEAT-024.

## 6. Target Browser Audio Ingress

The target browser continuously sends PCM produced by an AudioWorklet. Server-side Silero VAD—not browser UI energy—is authoritative for speech boundaries.

```json
{
  "type": "CAPTURE_START",
  "sessionId": "sess_001",
  "format": {
    "encoding": "pcm_s16le",
    "sampleRateHz": 16000,
    "channels": 1,
    "frameMs": 20
  },
  "appliedAudioSettings": {
    "echoCancellation": true,
    "noiseSuppression": true,
    "autoGainControl": true
  }
}
```

Binary client → Runtime frames following `CAPTURE_START` belong to the session's single active capture stream. `CAPTURE_END` closes it. Queue sizes, drop policy, maximum frame size, and malformed-frame handling must be fixed in the technical design and tested under backpressure.

When server VAD establishes a turn, the Runtime emits:

```json
{
  "type": "USER_SPEECH_START",
  "seq": 100,
  "sessionId": "sess_001",
  "turnId": "turn_042",
  "timestamp": 1787625600100
}
```

```json
{
  "type": "USER_SPEECH_END",
  "seq": 101,
  "sessionId": "sess_001",
  "turnId": "turn_042",
  "timestamp": 1787625601200
}
```

A browser-side level detector may animate the UI or provide a local fast-stop hint, but it cannot finalize the authoritative turn. Applied AEC settings are diagnostic evidence, not proof of acoustic isolation.

## 7. Text and Transcript Events

Typed text remains a supported fallback:

```json
{
  "type": "USER_TEXT",
  "sessionId": "sess_001",
  "turnId": "turn_043",
  "text": "Read the docs folder"
}
```

The Runtime projects stabilized ASR output with ordered events:

```json
{
  "type": "STT_PARTIAL",
  "seq": 110,
  "sessionId": "sess_001",
  "turnId": "turn_042",
  "timestamp": 1787625601300,
  "text": "Please review..."
}
```

```json
{
  "type": "STT_FINAL",
  "seq": 114,
  "sessionId": "sess_001",
  "turnId": "turn_042",
  "timestamp": 1787625601600,
  "text": "Please review the documentation."
}
```

The backend retains `revisionId` and tentative/stable suffix history internally. The browser reconciles by `turnId` plus `seq`; it does not need model confidence or streaming word timestamps.

## 8. Agent, Task, and Policy Projections

`AGENT_STATE`, `TASK_START`, `TASK_PROGRESS`, and terminal task events are public summaries. They must not be treated as the scheduler's internal source of truth.

```json
{
  "type": "TASK_START",
  "seq": 130,
  "sessionId": "sess_001",
  "turnId": "turn_042",
  "taskId": "task_501",
  "timestamp": 1787625601700,
  "fromAgentId": "supervisor",
  "toAgentId": "research",
  "taskName": "Review documentation"
}
```

A first-release policy block is terminal and never means "waiting for approval":

```json
{
  "type": "TASK_STATE",
  "seq": 131,
  "sessionId": "sess_001",
  "turnId": "turn_042",
  "taskId": "task_501",
  "timestamp": 1787625601710,
  "state": "BLOCKED_POLICY",
  "reasonCode": "EXTERNAL_SIDE_EFFECT_NOT_ALLOWED",
  "message": "This action is not available in the first release."
}
```

No `WAITING_APPROVAL`, approval request, or approval decision event belongs to the first-release contract.

## 9. Response and Real TTS Streaming

```json
{
  "type": "TEXT_DELTA",
  "seq": 140,
  "sessionId": "sess_001",
  "turnId": "turn_042",
  "timestamp": 1787625602000,
  "agentId": "supervisor",
  "delta": "I found two design conflicts.",
  "isFinal": false
}
```

`TTS_START` opens one active Runtime → browser binary audio stream for a `turnId`; binary audio chunks follow; `TTS_END` closes it. The negotiated codec/PCM format belongs in `TTS_START`. The browser must play actual received samples—markers and simulated timers are insufficient.

Binary audio is ephemeral and is not included in `lastSeq` replay. On reconnect, partial microphone and TTS streams are abandoned; the Runtime sends a fresh public state snapshot or replayable terminal state so the UI cannot pretend that missing audio was delivered.

## 10. Interruption and Task Cancellation

These commands are intentionally different:

```json
{
  "type": "USER_INTERRUPT",
  "sessionId": "sess_001",
  "turnId": "turn_042"
}
```

- Stops generation/playback for the identified response turn.
- Does not cancel its logical task or background child jobs.
- Server VAD during TTS invokes the same response-scoped transition internally; explicit UI controls may send the command directly.

```json
{
  "type": "TASK_CANCEL",
  "sessionId": "sess_001",
  "taskId": "task_501"
}
```

- Targets one logical task.
- Propagates only to descendants declared cancellable.
- Requires idempotent handling and a replayable terminal result.
- A bare natural-language "cancel" must be clarified when the target is ambiguous.

## 11. Direct Agent Mode

```json
{
  "type": "USER_TARGET",
  "sessionId": "sess_001",
  "targetAgentId": "coding"
}
```

`USER_TARGET` expresses user intent. It never bypasses Supervisor validation, deterministic policy, tracing, budgets, or task tracking. The Runtime may reject an unavailable or disallowed target with a structured reason.

## 12. Reconnect and Replay

```text
Browser connects → CLIENT_HELLO(protocolVersion, sessionId, lastSeq)
                       ↓
Runtime validates version → AGENT_MANIFEST
                       ↓
Runtime replays available JSON events with seq > lastSeq
                       ↓
Normal JSON events plus non-replayable binary audio
                       ↓
Disconnect → bounded backoff → reconnect with lastSeq
```

- Sequence/replay applies to server JSON events, not binary audio.
- Replay buffers are bounded; retention and overflow behavior must be explicit.
- A reconnect during capture starts a new capture segment. A reconnect during playback must not replay stale audio.
- The Runtime must provide enough current public state for the UI to reconcile when the requested gap is no longer retained.

## 13. Internal Trace Contract

Every accepted turn creates one canonical internal context carrying `traceId`, `sessionId`, `turnId`, `revisionId`, `taskId`, `jobId`, `parentJobId`, `routeId`, `agentId`, and `attempt` as applicable. The Supervisor, scheduler, workers, Hermes adapter, response coordinator, and logging layer propagate that context.

Structural state transitions and failures are retained at 100%; high-frequency metrics are aggregated; content logging is opt-in or sampled; raw audio is off by default. Exact redaction, retention, sampling, and backpressure limits remain FEAT-016 acceptance work.

## 14. Decisions Still Required Before Technical Design Passes

- Freeze the next protocol version and v1 compatibility/deprecation behavior.
- Freeze binary audio framing, codec negotiation, queue bounds, and drop behavior.
- Define replay-buffer limits and the current-state snapshot schema.
- Define command acknowledgements/idempotency keys for task-affecting client commands.
- Define authentication and origin policy for anything beyond localhost/trusted LAN.
