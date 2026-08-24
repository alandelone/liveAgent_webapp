# Product Vision: Local-First Voice Agent System

> **A mobile-first voice interface backed by a local Supervisor that routes a specialized agent pool and escalates to Hermes only when local execution is insufficient.**

## The Problem

Most AI interfaces remain keyboard-first chat windows. They hide useful task progress, delay speech until whole responses are complete, and often bind the experience to one remote model or agent runtime. A local multi-agent system adds another problem: rich internal routing is valuable for debugging, but exposing its full graph in the product UI would create noise and couple presentation to implementation details.

## The Product

`livechat_agent` is one product with two explicit runtime boundaries:

- **Browser Web UI:** captures microphone audio, applies the browser acoustic front end, streams PCM, plays returned audio, and renders transcripts plus public agent/task summaries.
- **Backend Local Runtime Service:** runs server VAD, streaming ASR, the local Supervisor, worker scheduling, task tracking, deterministic policy enforcement, response coordination, TTS, tracing, and optional Hermes escalation.

The Local Supervisor is the primary orchestrator. The browser is not an orchestrator, and Hermes is not the default control plane.

### Browser responsibilities

- Request `getUserMedia` with echo cancellation, noise suppression, and gain control, then record the settings actually applied.
- Use AudioWorklet-based capture/playback so audio work does not block UI rendering.
- Send microphone PCM and user commands to the Local Runtime.
- Render manifest-defined agents, transcript updates, connection state, voice state, and read-only task summaries.
- Stop local playback promptly when an interruption is confirmed or explicitly requested.

### Local Runtime responsibilities

- Consume PCM and run authoritative Silero VAD and Qwen3-ASR streaming.
- Run the local Qwen Supervisor for routing, decomposition, and agent-pool tracking.
- Enforce policy independently of model output.
- Keep response interruption separate from task cancellation.
- Coordinate worker/Hermes results and stream real TTS audio.
- Preserve canonical internal traces for debugging and agent-performance review while exposing only bounded public projections to the UI.

### Deliberate exclusions

- The browser does not choose an execution route, run tools, or manage worker lifecycles.
- The first release does not execute externally visible, paid, irreversible, or high-impact actions and does not include an approval protocol.
- The product UI does not expose every internal route, retry, or job node.
- Model co-residency and latency targets are not treated as achieved until target-hardware evidence exists.

## Architecture

```text
┌──────────────────────────────────────────────────┐
│                  BROWSER WEB UI                  │
│ Mic + AEC/NS/AGC → AudioWorklet → PCM uplink    │
│ Spatial Voice Room · Transcript · Task summaries │
└────────────────────────┬─────────────────────────┘
                         │ WebSocket
                         ▼
┌──────────────────────────────────────────────────┐
│              LOCAL RUNTIME SERVICE               │
│ Silero VAD → Qwen3-ASR → Transcript Stabilizer  │
│                  ↓                               │
│         Qwen3 Local Supervisor                   │
│ Policy · Scheduler · Trace · Response · TTS      │
└──────────────┬───────────────────────┬───────────┘
               │                       │ selective escalation
               ▼                       ▼
     Specialized worker roles       Hermes
```

Runtime packaging is intentionally not implied by this diagram. WSL2, Linux containers, and split Windows/Linux processes remain candidates until the Phase 2 preflight produces reproducible evidence.

## Backend-Agnostic Presentation Contract

The UI consumes a manifest rather than hardcoded agent identities:

```json
{
  "id": "supervisor",
  "name": "Supervisor",
  "state": "thinking",
  "color": "#6366F1",
  "icon": "brain",
  "isOrchestrator": true
}
```

- Exactly one active manifest entry is selected as the center orb through `isOrchestrator`.
- Hermes can appear as a satellite while handling an escalation; its ID is not special to the frontend.
- Dormant workers remain hidden until relevant.
- Direct Agent Mode sends `targetAgentId` as a preference to the Local Runtime; policy and routing still pass through the Supervisor.

The current code still contains legacy `hermes` identity assumptions. Removing those assumptions is planned work, not an already completed capability.

## Voice Pipeline Principles

```text
Web microphone
  → browser AEC/NS/AGC
  → AudioWorklet PCM
  → server Silero VAD
  → streaming Qwen3-ASR
  → transcript stabilization
  → local Supervisor and workers
  → response coordinator
  → streaming TTS
  → browser playback
```

- **First-audio latency is the core KPI.** Measure `speech_end → first audible response` end to end and report distributions, not only an average.
- **Barge-in is response-scoped.** User speech stops the active generated response and TTS; background task execution continues.
- **Task cancellation is explicit.** `TASK_CANCEL` requires an identifiable task target and has separate propagation rules.
- **Echo control is a tested requirement.** Browser constraints alone are not proof that speaker audio will not retrigger VAD.
- **Voice-first is not voice-only.** Text input, push-to-talk, and headset fallback cover permissions, noisy rooms, and acoustic failure cases.
- **Audio must be real.** Text markers and simulated playback timers do not satisfy microphone, TTS, or barge-in acceptance.

## Interaction Model

### Spatial Voice Room

```text
┌─────────────────────────┐
│      ○ Research         │
│                         │
│  ○ Coding       ○ Web  │
│                         │
│          ◉              │
│      Supervisor         │
│                         │
│  ○ Files      ○ Hermes │
│                         │
│       🎙 / ⌨️           │
└─────────────────────────┘
```

- Tap the center orb to control listening.
- Tap or swipe toward a worker to express a direct-target preference.
- Keep transcript and task summaries in drawers/panels rather than rendering internal scheduling nodes on the main canvas.
- On larger screens, optional execution views remain read-only public summaries; full traces stay in internal logs.

### Agent visual states

| State | Meaning | Visual intent |
|---|---|---|
| `idle` | Available | Gentle breathing pulse |
| `listening` | User audio is active | Input-reactive ripple |
| `thinking` | Supervisor/worker is reasoning | Rotating pulse |
| `speaking` | Audible TTS is playing | Output-reactive wave |
| `executing` | A tool or bounded job is running | Progress indicator |
| `delegating` | Supervisor assigned work | Beam to public target |
| `waiting` | Waiting for a dependency | Dim pulse |
| `interrupted` | Current response was stopped | Rapid settle |
| `error` | Operation failed | Error icon plus non-color cue |

## First-Release Safety Boundary

The first release permits only read-only operations and explicitly allowlisted local reversible operations. Externally visible, paid, irreversible, or high-impact actions return `BLOCKED_POLICY` and do not execute. This enforcement belongs in deterministic execution adapters; Supervisor classification is advisory. `WAITING_APPROVAL` and approval events are deferred to a later design.

## North-Star Demonstration

> The user speaks through the Web App → server VAD and ASR produce a stable turn → the local Supervisor delegates to Research and Coding → the UI shows bounded public progress → the response begins playing as real audio → the user interrupts mid-sentence → playback and the current response stop while background work continues → the Supervisor handles the new turn → internal logs can reconstruct every route, retry, and worker result.

This demonstration is not considered complete if any microphone, model, TTS, or playback segment is mocked or simulated.

## Delivery Order

The authoritative feature ordering and pass state live in [`feature-list.json`](../feature-list.json):

1. Preserve and truthfully scope the verified transport/UI replay baseline.
2. Freeze architecture, supported Linux GPU runtime, trace policy, and deterministic evidence.
3. Implement real browser PCM ingress and server VAD.
4. Add streaming ASR and transcript stabilization.
5. Add the local Supervisor, agent-pool scheduler, Hermes escalation, and cancellation isolation.
6. Add real TTS/playback, response coordination, acoustic barge-in, and echo-control evidence.
7. Run bilingual routing, policy, latency, VRAM, and operational release validation.
