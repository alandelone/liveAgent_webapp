# Product Vision: Hermes Voice UI

> **A mobile-first real-time voice interface for the Hermes agent runtime. Hermes is the brain; this project is the eyes, ears, and mouth.**

---

## The Problem

Today's AI interfaces are text-heavy chat windows bolted onto single-agent LLM backends. They hide multi-agent orchestration behind nested log panels, force keyboard-first interaction on mobile devices, and couple tightly to specific backend runtimes. The result: users read more than they speak, wait for complete responses instead of conversing fluidly, and have zero spatial awareness of what their agent ecosystem is actually doing.

## The Solution

`livechat_agent` is a **presentation-layer web application** — not an agent runtime. It connects to Hermes through a thin event protocol and exposes it as a **Spatial Voice Room**: a constellation of living orbs you speak to, swipe between, and watch collaborate.

### What This Project Does
- Captures user voice and streams it to Hermes
- Renders Hermes responses as streaming voice and text
- Visualizes Hermes's internal agent states and task delegation as animated orbs
- Provides gesture and touch controls for agent interaction

### What This Project Does NOT Do
- Reason, plan, or decide which agent handles a task (Hermes does this)
- Execute tools, shell commands, or file operations (Hermes does this)
- Manage subagent lifecycles or task graphs (Hermes does this)
- Synthesize voice or run STT/TTS (Hermes does this)

The center orb is a **visual representation of Hermes**, not a frontend orchestrator. When Hermes delegates internally, the frontend only visualizes that delegation. The UI never decides which side agent receives work.

## The Boundary: Backend-Agnostic Protocol

The frontend consumes exactly this contract per agent:

```json
{ "id": "coding", "name": "Coding", "state": "thinking", "color": "#3B82F6", "icon": "code" }
```

This means:
- **No hardcoded agent identities.** The agent constellation is dynamically generated from a manifest Hermes sends on connection.
- **Swappable backend.** Replace Hermes with any runtime that speaks the same event protocol, and the interface works unchanged.
- **Active constellation, not permanent display.** Show Hermes plus currently active/relevant agents. Dormant agents stay hidden until Hermes invokes them.

---

## Architecture: 4 Layers

```text
┌─────────────────────────────────────────────┐
│              MOBILE WEB APP                 │  ← This project (Layer 1)
│  Spatial Voice Room · Orb Constellation     │
│  Gestures · Transcripts · Task Tree         │
└────────────────────┬────────────────────────┘
                     │ WebSocket (Audio + JSON Events)
                     │ seq numbers · protocolVersion
                     ▼
┌─────────────────────────────────────────────┐
│           REAL-TIME VOICE LAYER             │  ← Hermes (Layer 2)
│  VAD → STT → Turn Detection → LLM → TTS   │
└────────────────────┬────────────────────────┘
                     ▼
┌─────────────────────────────────────────────┐
│             AGENT EVENT BUS                 │  ← Hermes (Layer 3)
│  Main Orchestrator → Side Agent Delegation  │
└──────┬──────────────┬──────────────┬────────┘
       ▼              ▼              ▼
  ┌─────────┐   ┌─────────┐   ┌─────────┐     ← User's Local Machine (Layer 4)
  │ Agent A │   │ Agent B │   │ Agent C │
  └─────────┘   └─────────┘   └─────────┘
```

**Layer 1 is the only layer we build.** Layers 2–4 are consumed via the event protocol.

---

## Voice Pipeline: Streaming, Not Batch

```text
Mic → Echo Cancel → VAD → Streaming STT → Hermes LLM → Text Chunks → Streaming TTS → Speaker
```

### Core Voice Principles
- **First-audio latency is the core KPI.** TTS synthesis begins on the first sentence boundary, not after full LLM completion. This is what makes voice feel like conversation rather than dictation.
- **Barge-in is a top-tier feature.** User speech immediately kills TTS playback and begins a new turn. Background tasks (file processing, code execution) are **never** interrupted by voice barge-in.
- **"Stop speaking" ≠ "Stop task."** Voice interruption and task cancellation are separate commands.
- **Echo cancellation is mandatory.** Without it, Hermes's own TTS output triggers VAD, creating an infinite self-interruption loop.
- **Push-to-talk is a fallback.** Automatic VAD is ideal, but noisy rooms and speakerphone conditions make it unreliable.
- **Text input is a fallback.** Voice-first ≠ voice-only. Code snippets, URLs, filenames, and microphone permission failures need a text path.

### Latency Targets to Measure
- `speech_end → Hermes receives turn`
- `Hermes response → first text delta`
- `first text delta → first audio chunk`
- `speech_end → first audible response` (end-to-end)

---

## Interaction Paradigms

### Mobile Primary: Spatial Voice Room
```text
┌─────────────────────────┐
│                         │
│      ○ Research         │
│                         │
│  ○ Coding       ○ Web  │
│                         │
│          ◉              │
│        Hermes           │
│                         │
│  ○ Files       ○ Auto  │
│                         │
│       🎙 / ⌨️           │
└─────────────────────────┘
```
- **Tap** center orb → toggle listening
- **Tap** satellite orb → enter Direct Agent Mode
- **Swipe** from center toward satellite → also enters Direct Agent Mode
- Transcript lives in a bottom-sheet drawer, not on the main screen

### Desktop / Tablet: 3-Pane Extended Layout (deferred after voice works)
- **Left**: Collapsible chat transcripts & streaming markdown
- **Center**: Spatial voice room (orb constellation)
- **Right**: Collapsible multi-agent task tree & execution logs (read-only)

### Dual Interaction Modes
- **Orchestrator Mode (default)**: User speaks → Hermes decides → delegates → synthesizes → speaks back. Side agent work is visible as orb state changes.
- **Direct Agent Mode**: User taps/swipes to a satellite → frontend sends `targetAgentId` to Hermes → Hermes routes accordingly. The frontend does **not** bypass Hermes infrastructure.

---

## Agent Visual States

States must be **semantically meaningful** and communicated through animation + icon + label, not color alone (color identifies agent identity):

| State | Meaning | Visual |
|-------|---------|--------|
| `idle` | Available, not working | Gentle breathing pulse |
| `listening` | Receiving user audio | Ripple waves modulated by mic amplitude |
| `thinking` | Hermes is reasoning | Rotating/pulsing think animation |
| `speaking` | TTS audio playing | Undulations modulated by TTS amplitude |
| `executing` | Running a tool | Spinning gear/progress indicator |
| `delegating` | Assigning work to side agent | Energy beam to target |
| `waiting` | Waiting for side agent result | Dim pulse |
| `error` | Something failed | Red glow + error icon |

Side agents have auxiliary states: `delegated`, `tool_call`, `background`, `completed`.

---

## North-Star MVP Demo

The entire v0.1 is judged by one interaction:

> User talks naturally to Hermes → Hermes delegates to Research and Coding → the UI visually shows those agents working → Hermes begins speaking the result → user interrupts mid-sentence → speech stops instantly → background work continues → Hermes responds to the new turn.

**If that one interaction feels fluid, the core product is working.**

### MVP Build Order
```text
Phase 0: Foundation     → WebSocket + reconnect + mock replay server + manifest
Phase 1: Voice          → State machine + streaming pipeline + barge-in + center orb
Phase 2: Multi-Agent    → Active satellite constellation + gestures + mode switching
Phase 3: Panels         → Responsive layout + transcript + task tree
```
