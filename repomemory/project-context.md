# Project Context & Invariants

## Product Vision
`livechat_agent` is a real-time, voice-first web collaboration interface designed to wrap the **Hermes** agent framework. It enables users to have fluid, natural voice and text conversations with a primary agent to brainstorm concepts, pull and organize local workstation files, and coordinate parallel background subagents.

## Core Interaction Architecture
```
+-----------------------------------------------------------------------------------+
|                                  LIVECHAT_AGENT                                   |
|                                                                                   |
|  +--------------------+   +--------------------------------+   +---------------+  |
|  |     LEFT PANE      |   |          MIDDLE PANE           |   |  RIGHT PANE   |  |
|  |  Chat Transcripts  |   |    Central Hero Voice Orb      |   |  Multi-Agent  |  |
|  |  & Live Markdown   |   |   + Dynamic Satellite Orbs     |   |   Task Tree   |  |
|  |                    |   |    (Subagents Activity)        |   |   & Logs      |  |
|  +--------------------+   +--------------------------------+   +---------------+  |
+------------------------------------------+----------------------------------------+
                                           | Full-Duplex WebSocket
                                           v
                         +-----------------------------------+
                         |      Hermes Agent Backend         |
                         | (C:\Users\Alandelone\hermes-agent)|
                         | - Local File Tools                |
                         | - Subagent Orchestration Engine   |
                         | - LLM & Audio Pipeline            |
                         +-----------------------------------+
```

## System Invariants & Non-Negotiable Red Lines
1. **Interface & Responsibility Boundary**:
   - `livechat_agent` is strictly a presentation and real-time streaming interface.
   - All filesystem operations, shell execution, permission control, and subagent process management belong to `hermes-agent`. `livechat_agent` must NEVER bypass Hermes to execute OS-level destructive commands.
2. **State Truth Source**:
   - UI state (subagent status, chat transcripts, voice state) is strictly driven by the structured event stream from Hermes / Mock Server. No fabricated or phantom client state mutations.
3. **Deterministic Verification Invariant**:
   - All feature pass states (`passes: true` in `feature-list.json`) must be proven by deterministic automated test suites executing against `test-fixtures/seed-data.json`.
4. **Audio & UI Main Thread Isolation**:
   - Web Audio processing and chunk queuing must not block the React UI render cycle. High frequency subagent log emissions must be throttled/buffered to prevent frame drops or audio stutter.
