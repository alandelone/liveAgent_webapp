# Web UI ↔ Local Runtime Real-Time Event Protocol

> **Legacy filename:** `hermes-protocol.md` is retained temporarily so existing links do not break. The protocol peer is now the **Local Runtime Service**. Hermes is an internal escalation adapter and does not own the browser session.

## 1. Contract Status

This document separates verified behavior from later v0.2 targets. FEAT-018 through FEAT-026 now verify protocol-v2 PCM ingress, server VAD, streaming ASR adapters, transcript stabilization, deterministic policy/commands, structured Supervisor routing, bounded scheduling, Hermes-adapter controls, and cancellation isolation. Real TTS, audible playback, and acoustic barge-in remain target contracts until their gates pass.

### Implemented v1 baseline

- `protocolVersion: 1` handshake with `CLIENT_HELLO` and `AGENT_MANIFEST`.
- Server-event sequence numbers, reconnect with `lastSeq`, heartbeat/liveness handling, and deterministic JSONL replay tests.
- Schema/client/fixture coverage for user text/target intent, transcript/state/text markers, task summaries, and TTS start/end markers; this does not prove that every event is produced by the live bridge.
- The endpoint defaults to `ws://127.0.0.1:8765/ws`. `VITE_HERMES_WS_URL` is a legacy configuration name.

### Implemented protocol-v2 speech path

- AudioWorklet capture performs stateful device-rate resampling, mono downmix, exact 20 ms PCM framing, and bounded binary uplink.
- The Runtime validates capture state/format/frame size, bounds the per-session queue, and emits explicit invalid/backpressure errors.
- Server-side VAD is authoritative; deterministic/energy/Silero probability adapters share the same state machine.
- Fake and pinned Qwen3-ASR vLLM adapters produce ordered partial/final transcripts through a stable-prefix/tentative-suffix layer.
- Text and push-to-talk remain fallbacks. Browser Web Speech no longer generates authoritative transcripts.

### Remaining target behavior

- Real TTS audio, audible playback, response coordination, and acoustic barge-in are not yet claimed by this protocol evidence. Hermes transport remains disabled in deployment pending an audited read-only/no-tools invocation path.
- Cosmetic legacy class/type names remain, but production orchestrator behavior is selected from `AGENT_MANIFEST.isOrchestrator`.

Unverified TTS, playback, response-coordination, and acoustic barge-in rules below remain **v0.2 target requirements** until their feature gates pass. Protocol v2 is frozen for these semantics. The Runtime accepts v1 text-only clients for one release and rejects v1 binary audio explicitly.

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
  "protocolVersion": 2,
  "sessionId": "sess_001",
  "lastSeq": null,
  "capabilities": [
    "audio_pcm_s16le_16k_mono_20ms",
    "command_ack",
    "state_snapshot"
  ]
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

| Field       | Purpose                                                             |
| ----------- | ------------------------------------------------------------------- |
| `type`      | Versioned event discriminator.                                      |
| `seq`       | Monotonically increasing server-event sequence within the session.  |
| `sessionId` | Stable conversation identifier across reconnects.                   |
| `timestamp` | Unix epoch milliseconds from the Local Runtime clock.               |
| `turnId`    | Included when the event belongs to one user/response turn.          |
| `taskId`    | Included when the event is a public projection of one logical task. |

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

`modeStore.ts`, `agentStateMachine.ts`, `manifestStore.ts`, transcript presentation, and constellation presentation now derive the orchestrator from the manifest. Legacy `HermesClient`, `HermesEventBus`, CSS color tokens, fixture names, and the compatibility environment alias are cosmetic/API migration debt; they must not regain semantic control-plane meaning.

## 6. Verified Browser Audio Ingress

The browser sends PCM produced by an AudioWorklet. Server-side VAD—not browser UI energy—is authoritative for speech boundaries.

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

Binary client → Runtime frames following `CAPTURE_START` belong to the session's single active capture stream. Each frame is exactly 20 ms/640 bytes. `CAPTURE_END` closes it. The browser queue holds at most 100 frames with 128 KiB/32 KiB high/low watermarks and drops the oldest unsent frame under pressure. The Runtime queue holds at most 200 frames; sustained overflow fails capture with `AUDIO_BACKPRESSURE`, while malformed or out-of-state frames fail with `INVALID_AUDIO_FRAME`.

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

`TTS_START` opens one active Runtime → browser binary audio stream for a `turnId`; binary audio chunks follow; `TTS_END` closes it. Protocol v2 uses strict mono float32 little-endian PCM at 24 kHz:

```json
{
  "type": "TTS_START",
  "seq": 141,
  "sessionId": "sess_001",
  "turnId": "turn_042",
  "agentId": "local-supervisor",
  "streamId": "tts-42-0-a1b2c3d4",
  "format": {
    "encoding": "pcm_f32le",
    "sampleRateHz": 24000,
    "channels": 1,
    "chunkFrames": 2400
  }
}
```

Exactly one downstream stream is active. Ordered binary messages are at most 9,600 bytes/2,400 frames and belong to the stream between its markers. Empty, misaligned, oversized, nested, or stale binary is rejected by the browser boundary. `TTS_END` repeats `streamId` and declares `COMPLETED`, `INTERRUPTED`, `FAILED`, or `TEXT_ONLY`. A live `COMPLETED` outcome requires non-empty validated PCM; markers and simulated timers are insufficient.

Binary audio is ephemeral and is not included in `lastSeq` replay. On reconnect, partial microphone and TTS streams are abandoned; the Runtime sends a fresh public state snapshot or replayable terminal state so the UI cannot pretend that missing audio was delivered.

The initial official Qwen3-TTS high-level API returns complete clause waveforms and explicitly does not provide true streaming generation. The Runtime therefore synthesizes bounded clauses and streams their PCM chunks honestly; it does not claim model-native online streaming. Text is emitted independently and remains available on every synthesis/playback failure.

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

Structural state transitions and failures are retained at 100% for 7 days; errors for 30 days; one-minute metric aggregates for 14 days. Content is off by default and opt-in samples are 0.5% capped at 50 turns/day for 7 days. Raw audio is off. Records are capped at 256 KiB and enter a 10,000-record priority queue with the redaction and backpressure rules in the accepted Discovery brief.

## 14. Frozen v2 Operational Limits

- Version 2 is current; version 1 is text-only for one release.
- Capture is PCM S16LE/16 kHz/mono/20 ms; queues and failure behavior are fixed in Section 6.
- Replay retains 2,048 JSON events for at most 10 minutes; overflow sends `STATE_SNAPSHOT` plus `REPLAY_OVERFLOW`. Audio is never replayed.
- Task-affecting commands carry `commandId`; 4,096 outcomes are cached for 15 minutes per session and acknowledged with replayable `COMMAND_ACK`.
- The first release is localhost-only. LAN/remote exposure is unsupported until TLS, authentication, explicit origins, and threat modeling are designed.
