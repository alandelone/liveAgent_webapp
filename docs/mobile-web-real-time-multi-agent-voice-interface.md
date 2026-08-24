# Mobile Web Real-Time Multi-Agent Voice Interface

> **Status:** Target interaction specification. Runtime ownership is governed by ADR-008 and [`liveagent_voice_pipeline_design.md`](liveagent_voice_pipeline_design.md). Earlier Hermes-only wording is superseded: the Local Supervisor is the primary orchestrator and Hermes is an optional escalation worker.

## Core Concept

The core philosophy is not putting orchestration into the browser, but rather:

> **Use a mobile-first real-time Voice UI as the presentation and acoustic front end for a backend Local Runtime, where the Local Supervisor routes a specialized worker pool and may escalate difficult work to Hermes.**

---

# 1. Overall Architecture

The architecture is divided into 4 distinct layers:

```text
┌───────────────────────────────────────────┐
│             MOBILE WEB APP                │
│                                           │
│   ┌─────────┐                             │
│   │ Side A  │        ┌─────────────┐      │
│   │   ○     │        │             │      │
│   └─────────┘   ○────│    MAIN     │────○ │
│                      │ ORCHESTRATOR │      │
│   ┌─────────┐   ○────│      ◉      │────○ │
│   │ Side B  │        └─────────────┘      │
│                                           │
│        Real-time Voice / Animation        │
└───────────────────────┬───────────────────┘
                        │
                        │ WebSocket / WebRTC
                        ▼
┌───────────────────────────────────────────┐
│           REAL-TIME VOICE LAYER           │
│                                           │
│ PCM → Silero VAD → Qwen3-ASR             │
│                    │                      │
│                    ▼                      │
│              Local Supervisor             │
│                    │                      │
│                    ▼                      │
│ Streaming Text → TTS → Audio Playback    │
└───────────────────────┬───────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────┐
│          LOCAL RUNTIME CONTROL PLANE      │
│                                           │
│        Local Supervisor (primary)         │
│                    │                      │
│       ┌────────────┼───────────────┐      │
│       ▼            ▼               ▼      │
│  Local worker  Local worker   Hermes      │
│   Research       Coding      escalation   │
└───────────────────────────────────────────┘

       User's Own Computer / Local Runtime
```

The browser portion of the first layer performs `getUserMedia` capture, requests and verifies AEC/NS/AGC, frames audio in an AudioWorklet, and sends PCM. Silero VAD remains authoritative in the Local Runtime. WebRTC is deferred; WebSocket is the first transport target.

### Decoupling Principle: Frontend is Backend-Agnostic

**The frontend must not know the Local Supervisor's internal routing graph or Hermes adapter details.**

The Frontend only needs to consume:
- `Agent ID`
- `Agent Name`
- `Agent State`
- `Voice State`
- `Audio Stream`
- `Visual State`

Example schema:
```json
{
  "id": "coding",
  "name": "Coding Agent",
  "state": "thinking",
  "voice": "voice_c",
  "color": "#3B82F6"
}
```

This allows changing local models, worker implementations, or the Hermes adapter without rewriting the UI. The orchestrator is selected from the manifest through `isOrchestrator`; no `hermes` ID may be required by presentation logic.

---

# 2. UI Core Design: Orb-based Multi-Agent Interface

The UI is modeled as an interactive constellation of orbs / bubbles in a spatial voice environment:

```text
             ○ Agent A


      ○ Agent B      ○ Agent C


                ◉
          MAIN ORCHESTRATOR


      ○ Agent D      ○ Agent E


             ○ Agent F
```

- Each Agent is an **interactive orb / bubble**.
- Replaces traditional chat lists, message boxes, and send buttons with a **spatial voice room**.

---

# 3. Main Orchestrator

The manifest-selected Local Supervisor is permanently anchored at the center. "Main Agent" below is a visual role, not a browser-side runtime:

```text
              Side Agent
                  ○

     Side Agent ○     ○ Side Agent


                  ◉
              MAIN AGENT


     Side Agent ○     ○ Side Agent

                  ○
              Side Agent
```

The Main Agent's orb dynamically changes animations based on its state:
- `Idle`
- `Listening`
- `Thinking`
- `Speaking`
- `Executing`
- `Delegating`
- `Interrupted`
- `Error`

### State Animation Examples

- **Idle**: Gentle breathing cycle (`◉ → ◉ → ◉`)
- **Listening**: Microphone input amplitude / frequency modulates ripple waves:
  ```text
        ◉
      ~~~~~
    ~~~~~~~~~
      ~~~~~
  ```
- **Speaking**: Visualizer ripples undulating to TTS audio amplitude in real time:
  ```text
         ~~~~~
      ~~  ◉  ~~
         ~~~~~
  ```

---

# 4. Side Agents

Side agents are alive, reactive objects rather than static buttons:

```text
        🟣 Research
             ○


 🔵 Coding ○       ○ 🟢 Browser


             ◉
          Orchestrator


 🟠 Files ○         ○ 🟡 Automation
```

Each Agent maintains:
- `color`
- `orb size`
- `voice`
- `position`
- `label`
- `icon`
- `activity state`

Configurations originate from backend definitions (e.g. YAML/JSON) and are streamed to the frontend:

```yaml
agents:
  - id: research
    name: Research
    color: purple
    voice: voice_research

  - id: coding
    name: Coding
    color: blue
    voice: voice_coding

  - id: browser
    name: Browser
    color: green
    voice: voice_browser
```

---

# 5. Agent Selection Interaction: Center → Swipe → Side Agent

Interaction is driven by direct gestures:

```text
        ○ Coding

        ↑
        │
        │ swipe
        │
        ◉
      Main
```

1. User swipes from Main Orb towards a Side Agent.
2. Selected Agent transitions:
   - `scale: 1.0 → 1.25`
   - `glow: increase`
   - `label: appear`
   - `audio focus: switch`
3. Direct conversation mode is activated between User and Selected Agent.

---

# 6. Interaction Modes

### Mode A — Orchestrator Mode (Default)
```text
User → Local Supervisor → Route → Worker/Hermes → Result → Response Coordinator → Voice
```
- The Local Supervisor delegates sub-tasks and the Local Runtime coordinates the final response. The user communicates through the orchestrator role.

### Mode B — Direct Agent Mode
```text
User → Swipe / Select → targetAgentId preference → Local Supervisor validates → Selected worker
```
- Direct Mode changes the requested target; it does not bypass Supervisor routing, deterministic policy, tracing, or task tracking.

---

# 7. Delegation & Summoning Animation

When the Main Orchestrator delegates a task to a Side Agent:

```text
       ◉────────→○
      Main       Coding
```

1. An energetic beam or trajectory flows from Main to the target Side Agent.
2. The Side Agent illuminates:
   ```text
      ◉  ~~~~~~~~  ○
    Main          Coding
   ```
3. Side Agent processes the task in the background.
4. On completion, the result returns to Main, and the Side Agent smoothly transitions back to Idle.
5. Users understand task progression visually without reading text logs.

---

# 8. Real-Time Streaming Voice Pipeline

Avoid batch execution (`Record → Full STT → Full LLM → Full TTS → Playback`). Use a low-latency chunk-based streaming pipeline:

```text
Microphone
     │
     ▼
Browser AEC/NS/AGC
     │
     ▼
AudioWorklet PCM
     │
     ▼
Server Silero VAD
     │
     ▼
 Streaming STT
     │
     ▼
 Partial Text
     │
     ▼
Local Supervisor / Worker
     │
     ▼
 Streaming LLM
     │
     ▼
 Text Chunks
     │
     ▼
 Streaming TTS
     │
     ▼
 Audio Chunks
     │
     ▼
 Speaker
```

**Key Principle**: Begin TTS synthesis and audio playback immediately on incremental sentence/clause chunks rather than waiting for full LLM completion.

---

# 9. Interrupt & Barge-in Handling

The system must support instantaneous user interruption:

```text
MIC Input Detected (VAD)
          │
          ▼
       Barge-in
          │
          ▼
   STOP TTS Playback
          │
          ▼
Cancel Current Voice Response
          │
          ▼
  Preserve Conversational Context
          │
          ▼
    Start New Turn
```

### Differentiating Conversation vs. Background Tasks
- **Conversation Tasks** (`LLM speech stream`, `TTS synthesis`, `audio output`): **CANCEL immediately** upon barge-in.
- **Background Tasks** (`GitHub search`, `file processing`, `code execution`, `web scraping`): **CONTINUE running**.

---

# 10. Event-Driven Backend Architecture

Communication between Frontend and Gateway is fully event-driven over WebSocket / WebRTC:

### Core Event Types
- `CAPTURE_START` / `CAPTURE_END` plus non-replayable binary PCM frames
- `USER_SPEECH_START` / `USER_SPEECH_END`
- `STT_PARTIAL` / `STT_FINAL`
- `AGENT_THINKING` / `AGENT_TOOL_CALL`
- `AGENT_TEXT_DELTA` / `AGENT_RESPONSE_END`
- `TTS_START` / `TTS_AUDIO_DELTA` / `TTS_END`
- `USER_INTERRUPT`
- `TASK_START` / `TASK_PROGRESS` / `TASK_COMPLETE` / `TASK_CANCEL`
- A public task-state event for deterministic `BLOCKED_POLICY`

`USER_INTERRUPT` is response-scoped; `TASK_CANCEL` is task-scoped. Internal route/job identifiers and full traces remain backend-only. Exact v0.2 event names and version negotiation are frozen in the protocol design gate, not inferred from this interaction document.

---

# 11. Frontend State Machine

Unified State Machine for Main and Side Agents:

```text
                 ┌──────────┐
                 │   IDLE   │
                 └────┬─────┘
                      │
                      ▼
               ┌─────────────┐
               │ LISTENING   │
               └──────┬──────┘
                      │
                      ▼
               ┌─────────────┐
               │ PROCESSING  │
               └──────┬──────┘
                      │
                      ▼
               ┌─────────────┐
               │  SPEAKING   │
               └──────┬──────┘
                      │
            ┌─────────┴─────────┐
            │                   │
            ▼                   ▼
       INTERRUPTED            DONE
            │                   │
            └─────────┬─────────┘
                      ▼
                     IDLE
```

Side Agents have auxiliary states: `DELEGATED`, `TOOL_CALL`, `BACKGROUND`.

---

# 12. Minimalist Spatial UI Layout

A clean, clutter-free mobile interface focused on spatial voice presence:

```text
┌─────────────────────────┐
│                         │
│      ○ Research         │
│                         │
│  ○ Coding       ○ Web  │
│                         │
│          ◉              │
│       Assistant         │
│                         │
│  ○ Files       ○ Agent │
│                         │
│                         │
│          🎙             │
│                         │
└─────────────────────────┘
```

- No sidebars, dashboards, or heavy chat windows.
- Two primary mobile gestures:
  - **Tap Main Orb**: Start / Stop Listening.
  - **Swipe from Main Orb**: Switch target Agent.

---

# 13. Voice Identity

Each agent possesses a distinct acoustic persona:
- **Main / Assistant**: Balanced, neutral voice
- **Research**: Calm, deliberate voice
- **Coding**: Precise, technical voice
- **Browser / Web**: Fast, dynamic voice
- **Automation / Tasks**: Concise, prompt voice

Users instantly identify which agent is responding purely through audio cues.

---

# 14. Architecture Summary & Core Definition

### Definition
> **A mobile-first, real-time, voice-driven multi-agent interface that provides a spatial visual representation of a local agent ecosystem, with a central orchestrator and dynamically invoked side agents.**
>
> **一个以移动端为核心、实时语音驱动的多 Agent 交互界面。通过中心 Orchestrator 与周围 Side Agents 的空间化 Bubble 表现，让用户能够以语音、点击和滑动的方式直接与本地 Agent 系统交互。**

### Core Technological Pillars

```text
        MOBILE UI
            │
            ▼
   REAL-TIME VOICE BUS
            │
            ▼
     AGENT EVENT BUS
            │
            ▼
       LOCAL RUNTIME
  Supervisor · Workers · Hermes
```

The **Realtime Voice Bus** and **Agent Event Bus** form the backbone of the system, enabling low-latency streaming, instant barge-in interruptibility, and concurrent execution of background agent tasks.
