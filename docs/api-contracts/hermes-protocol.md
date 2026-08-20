# Hermes ↔ livechat_agent Real-Time Event Protocol

## 1. Connection & Handshake

- **Endpoint**: `ws://localhost:8765/ws` (Configurable via `VITE_HERMES_WS_URL`)
- **Protocol**: Full-duplex WebSocket. Binary frames for audio. Text frames for JSON events.
- **Handshake**: On connection, client sends `CLIENT_HELLO`. Hermes responds with `AGENT_MANIFEST`.

```json
// Client → Hermes
{
  "type": "CLIENT_HELLO",
  "protocolVersion": 1,
  "sessionId": "sess_001",
  "lastSeq": null,
  "capabilities": ["audio_pcm_16k", "audio_opus"]
}

// Hermes → Client (if resuming with lastSeq)
// Hermes replays all events with seq > lastSeq before sending new events
```

## 2. Common Event Envelope

Every JSON event from Hermes carries these fields:

```json
{
  "type": "EVENT_TYPE",
  "seq": 1521,
  "sessionId": "sess_001",
  "timestamp": 1771234567890,
  ...event-specific fields
}
```

| Field | Purpose |
|-------|---------|
| `seq` | Monotonically increasing sequence number. Used for gap detection on reconnect. |
| `sessionId` | Stable across reconnects within one conversation. |
| `timestamp` | Unix epoch milliseconds from Hermes server clock. |

**Forward compatibility rule**: The client MUST ignore event types it does not recognize. This allows Hermes to add new events without breaking older frontends.

**Validation rule**: Every incoming event is validated against schema. Malformed events are logged as warnings, never crash the UI.

## 3. Agent Manifest (Handshake Response)

```json
{
  "type": "AGENT_MANIFEST",
  "seq": 1,
  "agents": [
    { "id": "hermes", "name": "Hermes", "color": "#6366F1", "icon": "brain", "isOrchestrator": true },
    { "id": "research", "name": "Research", "color": "#A855F7", "icon": "book-open" },
    { "id": "coding", "name": "Coding", "color": "#3B82F6", "icon": "code" },
    { "id": "browser", "name": "Browser", "color": "#10B981", "icon": "globe" },
    { "id": "automation", "name": "Automation", "color": "#F59E0B", "icon": "cpu" }
  ]
}
```

- The frontend generates its orb constellation entirely from this manifest.
- Hermes may send an updated `AGENT_MANIFEST` mid-session if agents are created or retired.
- Agents not currently active are displayed based on Hermes `AGENT_STATE` events, not manifest presence.

## 4. Voice Activity & Speech Events

```json
// Client → Hermes: User started speaking (VAD trigger)
{ "type": "USER_SPEECH_START", "sessionId": "sess_001", "turnId": "turn_042" }

// Client → Hermes: User stopped speaking
{ "type": "USER_SPEECH_END", "sessionId": "sess_001", "turnId": "turn_042" }

// Client → Hermes: Binary audio frames sent as WebSocket binary messages
// (no JSON wrapper — raw PCM 16-bit 16kHz mono or Opus)

// Client → Hermes: User typed text instead of speaking
{ "type": "USER_TEXT", "sessionId": "sess_001", "turnId": "turn_042", "text": "Read the docs folder" }

// Client → Hermes: User wants to talk to a specific agent
{ "type": "USER_TARGET", "sessionId": "sess_001", "targetAgentId": "coding" }
```

## 5. STT Transcription Events (Hermes → Client)

```json
// Streaming partial transcript
{ "type": "STT_PARTIAL", "seq": 100, "turnId": "turn_042", "text": "Please search..." }

// Final transcript for the turn
{ "type": "STT_FINAL", "seq": 101, "turnId": "turn_042", "text": "Please search the repo for memory leaks." }
```

## 6. Agent State Events (Hermes → Client)

```json
{
  "type": "AGENT_STATE",
  "seq": 102,
  "agentId": "hermes",
  "state": "idle" | "listening" | "thinking" | "speaking" | "executing" | "delegating" | "waiting" | "interrupted" | "error",
  "detail": "Optional human-readable context, e.g. 'Running pytest suite'"
}
```

Side agent auxiliary states: `delegated`, `tool_call`, `background`, `completed`.

## 7. Streaming Text Response (Hermes → Client)

```json
// Incremental text chunk
{ "type": "TEXT_DELTA", "seq": 110, "agentId": "hermes", "turnId": "turn_042", "delta": "I found 3 potential ", "isFinal": false }

// End of text response
{ "type": "TEXT_DELTA", "seq": 115, "agentId": "hermes", "turnId": "turn_042", "delta": "memory leaks.", "isFinal": true }
```

## 8. TTS Audio Streaming (Hermes → Client)

```json
// TTS stream begins
{ "type": "TTS_START", "seq": 120, "agentId": "hermes", "turnId": "turn_042" }

// Binary audio chunks follow as WebSocket binary messages
// (raw PCM or Opus — no JSON wrapper)

// TTS stream ends
{ "type": "TTS_END", "seq": 125, "agentId": "hermes", "turnId": "turn_042" }
```

## 9. User Interruption (Client → Hermes)

```json
// Sent when VAD detects user speech during TTS playback
{ "type": "USER_INTERRUPT", "sessionId": "sess_001", "turnId": "turn_042" }
```

- Hermes MUST stop generating TTS audio for the interrupted turn.
- Hermes MUST NOT cancel background tasks in response to USER_INTERRUPT.

## 10. Task Orchestration Events (Hermes → Client)

```json
// Hermes delegates work to a side agent
{
  "type": "TASK_START",
  "seq": 130,
  "taskId": "task-501",
  "fromAgentId": "hermes",
  "toAgentId": "research",
  "taskName": "Scan documentation in /docs"
}

// Progress update
{
  "type": "TASK_PROGRESS",
  "seq": 135,
  "taskId": "task-501",
  "agentId": "research",
  "progress": 75,
  "log": "Found 12 occurrences in /docs"
}

// Task completed
{
  "type": "TASK_COMPLETE",
  "seq": 140,
  "taskId": "task-501",
  "agentId": "research",
  "resultSummary": "Documentation index created with 12 sections."
}
```

## 11. Reserved Event Types (Defined, Not Yet Implemented)

```json
// Explicit task cancellation (deferred — separate from voice barge-in)
{ "type": "TASK_CANCEL", "taskId": "task-501" }

// Structured artifact from Hermes (file, code patch, report, image)
{
  "type": "ARTIFACT",
  "seq": 150,
  "agentId": "coding",
  "taskId": "task-502",
  "artifactType": "file" | "code_patch" | "report" | "image",
  "name": "memory_leak_fix.patch",
  "contentUrl": "/artifacts/task-502/memory_leak_fix.patch",
  "preview": "```diff\n-  buffer = allocate()\n+  buffer = allocate_tracked()\n```"
}
```

## 12. Error Events (Hermes → Client)

```json
{
  "type": "ERROR",
  "seq": 200,
  "agentId": "hermes",
  "code": "TOOL_EXECUTION_FAILED",
  "message": "pytest exited with code 1",
  "recoverable": true
}
```

## 13. Connection Lifecycle

```text
Client connects → CLIENT_HELLO (protocolVersion, sessionId, lastSeq)
                    ↓
Hermes responds → AGENT_MANIFEST
                    ↓
              (if lastSeq provided, replay missed events)
                    ↓
              Normal bidirectional event + audio flow
                    ↓
Client disconnects → automatic reconnect with exponential backoff
                    ↓
              CLIENT_HELLO with lastSeq = last received seq
                    ↓
              Hermes replays gap → resume
```
