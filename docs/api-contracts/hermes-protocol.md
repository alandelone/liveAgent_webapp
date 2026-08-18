# Hermes Full-Duplex WebSocket Protocol Contract

## 1. Connection Overview
- **Endpoint**: `ws://localhost:8765/ws` (Configurable via `HERMES_WS_URL` or Mock Server)
- **Protocol**: Full-duplex WebSocket supporting Binary (Audio PCM/Opus chunks) & Text (JSON events).

## 2. Client -> Hermes Messages

### 2.1 Audio Stream (Binary Frame)
Raw PCM 16-bit 24kHz / 16kHz mono audio chunks.

### 2.2 Text / Control Events (JSON Frame)
```json
{
  "type": "user_text",
  "sessionId": "sess_12345",
  "text": "Please read project files and organize notes."
}
```

```json
{
  "type": "interrupt",
  "sessionId": "sess_12345"
}
```

## 3. Hermes -> Client Messages

### 3.1 Audio Output (Binary Frame)
TTS streaming audio chunk for client-side playback.

### 3.2 State & Transcript Events (JSON Frame)
```json
{
  "type": "agent_state",
  "state": "listening" | "thinking" | "speaking" | "idle",
  "timestamp": 1771234567890
}
```

```json
{
  "type": "transcript_chunk",
  "role": "user" | "agent",
  "chunk": "Let me inspect the workspace files...",
  "isFinal": false
}
```

```json
{
  "type": "subagent_event",
  "event": "spawned" | "progress" | "log" | "completed" | "failed",
  "subagentId": "sub-101",
  "name": "Repo Researcher",
  "role": "File Indexer",
  "status": "running",
  "progress": 45,
  "log": "Reading ./docs/project-index.md...",
  "timestamp": 1771234567890
}
```

```json
{
  "type": "tool_call",
  "toolName": "read_workspace_file",
  "status": "executing" | "success" | "error",
  "params": { "filePath": "docs/project-index.md" },
  "outputSummary": "Loaded 124 lines of markdown."
}
```
