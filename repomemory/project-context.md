# Project Context & Invariants

## Product Identity
`livechat_agent` is a **Hermes Voice UI** — a mobile-first, real-time voice interface for the Hermes agent runtime. Hermes is the brain; this project is the eyes, ears, and mouth. Full vision in [`docs/product-vision.md`](../docs/product-vision.md). Detailed spec in [`docs/mobile-web-real-time-multi-agent-voice-interface.md`](../docs/mobile-web-real-time-multi-agent-voice-interface.md).

## Architecture: User ↔ Voice/UI ↔ Hermes
```text
┌─────────────────────────────────────────────┐
│              MOBILE WEB APP                 │  ← This project (Layer 1)
│  Spatial Voice Room · Active Constellation  │
│  Gestures · Transcripts · Task Tree        │
└────────────────────┬────────────────────────┘
                     │ WebSocket (Audio + JSON Events)
                     │ seq numbers · protocolVersion
                     ▼
┌─────────────────────────────────────────────┐
│           HERMES AGENT RUNTIME              │  ← Layers 2-4
│  VAD · STT · LLM · TTS · Tools · Agents    │
└─────────────────────────────────────────────┘
```

## System Invariants (Non-Negotiable)

1. **Hermes is the only agent runtime.**
   - Frontend never reasons, delegates, executes tools, or manages agent lifecycles.

2. **Frontend never decides delegation.**
   - Center orb = visual Hermes, not frontend orchestrator. Direct Mode sends `targetAgentId` to Hermes.

3. **Optimistic UI state with Hermes reconciliation.**
   - Frontend MAY predict state transitions for immediacy (e.g. instant "listening" on mic tap). Hermes events remain source of truth — frontend reconciles when they arrive.

4. **Barge-in does not cancel background work.**
   - Voice interruption stops TTS only. Background tasks continue. "Stop speaking" ≠ "Stop task."

5. **Audio never blocks the UI thread.**
   - AudioWorklet for capture/playback. Throttle high-frequency telemetry to prevent frame drops.

6. **Echo cancellation is mandatory.**
   - Without it, Hermes TTS triggers VAD → infinite self-interruption loop.

7. **Active constellation, not permanent display.**
   - Show Hermes + currently active agents. Dormant agents hidden until invoked. No hardcoded agent identities.

8. **Task tree is read-only.**
   - Visualizes Hermes execution. Does not control it.

9. **First-audio latency is the core KPI.**
   - TTS starts at first sentence boundary. Measure `speech_end → first audible response`.
